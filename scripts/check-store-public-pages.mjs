import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PLACEHOLDER_PATTERN =
  /\{\{[^{}\r\n]{1,200}\}\}|\b(?:CHANGE[_ -]?ME|REPLACE[_ -]?ME|EXAMPLE\.COM|TODO|TBD)\b|&lt;\s*(?:real|your|verified)[^&]{0,100}&gt;/i;
const DRAFT_PATTERN =
  /publication\s+status:\s*fail-closed(?:\s+Store)?\s+(?:draft|source)|fail-closed\s+commercial\s+draft|Store\s+release\s+support\s+route\s+is\s+still\s+blocked|do\s+not\s+publish|not\s+ready\s+for\s+publication/i;
const AUTH_PATH_PATTERN =
  /(?:^|[./_-])(?:account|auth|authorize|login|log-in|oauth|sign-in|signin)(?:[./?_-]|$)/i;
const AUTH_PAGE_PATTERN =
  /<input\b[^>]*\btype\s*=\s*["']?password\b|<(?:form|main)\b[^>]*(?:login|log-in|sign-in|signin)|(?:cloudflare|security)\s+(?:challenge|verification)/i;
const REQUIRED_TEXT = {
  privacy: [
    ["privacy", "\u9690\u79c1"],
    ["publisher", "\u53d1\u5e03\u8005"],
    ["local-first", "local first", "\u672c\u5730\u4f18\u5148"],
    ["telemetry", "\u9065\u6d4b"],
    ["device", "\u8bbe\u5907"],
    ["contact", "\u8054\u7cfb"],
  ],
  support: [
    ["support", "\u652f\u6301"],
    ["publisher", "\u53d1\u5e03\u8005"],
    ["best-effort", "best effort", "\u5c3d\u529b"],
    ["security", "\u5b89\u5168"],
    ["issue", "\u95ee\u9898"],
    ["contact", "\u8054\u7cfb"],
  ],
};

export async function checkStorePublicPages(
  { privacyUrl = "", publisherDisplayName = "", supportUrl = "" },
  dependencies = {},
) {
  const pages = [
    ["privacy", privacyUrl],
    ["support", supportUrl],
  ];
  const results = await Promise.all(
    pages.map(async ([role, url]) => {
      try {
        assertExpectedPublisherName(publisherDisplayName);
        const result = await checkPublicPage(role, url, {
          ...dependencies,
          expectedPublisherName: publisherDisplayName,
        });
        return { ...result, ok: true };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "Unknown failure.",
          ok: false,
          role,
        };
      }
    }),
  );

  if (
    results.every((result) => result.ok) &&
    results[0].finalUrl === results[1].finalUrl
  ) {
    results[0] = {
      error: "Privacy and support must use distinct canonical public pages.",
      ok: false,
      role: "privacy",
    };
    results[1] = {
      error: "Privacy and support must use distinct canonical public pages.",
      ok: false,
      role: "support",
    };
  }

  return {
    checkedAt: new Date().toISOString(),
    decision: results.every((result) => result.ok) ? "pass" : "fail",
    pages: results,
    schemaVersion: 1,
  };
}

export async function checkPublicPage(role, rawUrl, dependencies = {}) {
  if (!(role in REQUIRED_TEXT)) {
    throw new Error("Page role must be privacy or support.");
  }
  const fetchFn = dependencies.fetchFn;
  const boundFetchFn = dependencies.boundFetchFn ?? fetchBoundPublicPage;
  const lookupFn = dependencies.lookupFn ?? dnsLookup;
  const maxBodyBytes = dependencies.maxBodyBytes ?? MAX_BODY_BYTES;
  const maxRedirects = dependencies.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const expectedPublisherName = dependencies.expectedPublisherName;
  if (
    (fetchFn !== undefined && typeof fetchFn !== "function") ||
    typeof boundFetchFn !== "function" ||
    typeof lookupFn !== "function"
  ) {
    throw new Error(
      "HTTPS transport and DNS lookup implementations are required.",
    );
  }
  if (
    !Number.isInteger(maxBodyBytes) ||
    maxBodyBytes < 256 ||
    !Number.isInteger(maxRedirects) ||
    maxRedirects < 0 ||
    maxRedirects > 10 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000
  ) {
    throw new Error("Public page checker limits are invalid.");
  }

  let currentUrl = parsePublicHttpsUrl(rawUrl, `${role} URL`);
  const visited = new Set([currentUrl.href]);
  const resolvedHosts = new Map();
  const redirects = [];

  for (;;) {
    const resolvedAddresses = await resolvePublicAddresses(
      currentUrl,
      lookupFn,
      resolvedHosts,
    );
    const requestOptions = {
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "Accept-Language": "en-US,en;q=0.8,zh-CN;q=0.7",
        "Cache-Control": "no-cache",
        "User-Agent": "JoeSSH-Store-Public-Page-Check/1",
      },
      redirect: "manual",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(timeoutMs),
    };
    let response;
    try {
      response = fetchFn
        ? await fetchFn(currentUrl, requestOptions)
        : await boundFetchFn(currentUrl, requestOptions, resolvedAddresses);
    } catch (error) {
      const detail =
        error instanceof Error && error.name === "TimeoutError"
          ? `timed out after ${timeoutMs} ms`
          : "could not be fetched without credentials";
      throw new Error(`${capitalize(role)} page ${detail}.`, { cause: error });
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirects.length >= maxRedirects) {
        throw new Error(
          `${capitalize(role)} page exceeded ${maxRedirects} redirects.`,
        );
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(
          `${capitalize(role)} page returned HTTP ${response.status} without Location.`,
        );
      }
      let nextUrl;
      try {
        const redirectUrl = new URL(location, currentUrl);
        if (looksLikeAuthenticationUrl(redirectUrl)) {
          throw new Error("authentication route");
        }
        nextUrl = parsePublicHttpsUrl(redirectUrl.href, `${role} redirect`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "authentication route"
        ) {
          throw new Error(
            `${capitalize(role)} page redirected to an authentication route.`,
            { cause: error },
          );
        }
        throw new Error(
          `${capitalize(role)} page redirected to a non-public or invalid target.`,
          { cause: error },
        );
      }
      if (nextUrl.origin !== currentUrl.origin) {
        throw new Error(
          `${capitalize(role)} page redirected across origins; configure the final canonical URL.`,
        );
      }
      if (visited.has(nextUrl.href)) {
        throw new Error(`${capitalize(role)} page has a redirect loop.`);
      }
      await response.body?.cancel();
      visited.add(nextUrl.href);
      redirects.push(nextUrl.href);
      currentUrl = nextUrl;
      continue;
    }

    if (response.status !== 200) {
      throw new Error(
        `${capitalize(role)} page returned HTTP ${response.status}; expected 200.`,
      );
    }
    if (response.headers.has("www-authenticate")) {
      throw new Error(
        `${capitalize(role)} page returned an authentication challenge.`,
      );
    }
    const contentType = assertHtmlContentType(
      role,
      response.headers.get("content-type"),
    );
    if (
      /\battachment\b/i.test(response.headers.get("content-disposition") ?? "")
    ) {
      throw new Error(`${capitalize(role)} page was served as a download.`);
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      if (!/^\d+$/.test(declaredLength.trim())) {
        throw new Error(
          `${capitalize(role)} page returned an invalid Content-Length.`,
        );
      }
      if (Number(declaredLength) > maxBodyBytes) {
        throw new Error(
          `${capitalize(role)} page exceeds the ${maxBodyBytes}-byte limit.`,
        );
      }
    }
    const { bytes, text } = await readUtf8Body(response, maxBodyBytes, role);
    assertPageContent(role, text, bytes, expectedPublisherName);
    return {
      bytes,
      contentType,
      finalUrl: currentUrl.href,
      redirects,
      role,
      status: response.status,
    };
  }
}

export function parsePublicHttpsUrl(rawUrl, label = "URL") {
  if (
    typeof rawUrl !== "string" ||
    rawUrl !== rawUrl.trim() ||
    rawUrl.length < 12 ||
    rawUrl.length > 2_048 ||
    /[\p{Cc}\p{Cf}]/u.test(rawUrl) ||
    PLACEHOLDER_PATTERN.test(rawUrl)
  ) {
    throw new Error(`${label} is missing, malformed, or still a placeholder.`);
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new Error(`${label} is not a valid absolute URL.`, { cause: error });
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !isPublicHostname(url.hostname)
  ) {
    throw new Error(
      `${label} must use public HTTPS without credentials or a fragment.`,
    );
  }
  return url;
}

function assertHtmlContentType(role, value) {
  if (!value) {
    throw new Error(`${capitalize(role)} page is missing Content-Type.`);
  }
  const parts = value.split(";").map((part) => part.trim().toLowerCase());
  if (parts[0] !== "text/html") {
    throw new Error(
      `${capitalize(role)} page must use text/html, not ${parts[0] || "an empty type"}.`,
    );
  }
  const charset = parts
    .slice(1)
    .find((part) => part.startsWith("charset="))
    ?.slice("charset=".length)
    .replace(/^['"]|['"]$/g, "");
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    throw new Error(`${capitalize(role)} page must use UTF-8.`);
  }
  return value;
}

async function readUtf8Body(response, maxBodyBytes, role) {
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error(`${capitalize(role)} page returned no readable body.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        throw new Error(
          `${capitalize(role)} page exceeds the ${maxBodyBytes}-byte limit.`,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (error instanceof Error && /exceeds the/.test(error.message)) {
      throw error;
    }
    throw new Error(`${capitalize(role)} page body is not valid UTF-8.`, {
      cause: error,
    });
  }
  return { bytes, text };
}

function assertPageContent(role, html, bytes, expectedPublisherName) {
  if (bytes < 256) {
    throw new Error(`${capitalize(role)} page is unexpectedly short.`);
  }
  if (
    !/<html(?:\s|>)/i.test(html) ||
    !/<title(?:\s|>)[\s\S]*?<\/title>/i.test(html) ||
    !/<body(?:\s|>)/i.test(html) ||
    !/<h1(?:\s|>)[\s\S]*?<\/h1>/i.test(html)
  ) {
    throw new Error(
      `${capitalize(role)} page must be a complete HTML document with title, body, and H1.`,
    );
  }
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b/i.test(html)) {
    throw new Error(`${capitalize(role)} page must not use a meta refresh.`);
  }
  if (PLACEHOLDER_PATTERN.test(html)) {
    throw new Error(`${capitalize(role)} page still contains a placeholder.`);
  }
  const exactVisibleText = extractVisibleText(html);
  const visibleText = exactVisibleText.toLowerCase();
  if (DRAFT_PATTERN.test(html) || DRAFT_PATTERN.test(visibleText)) {
    throw new Error(
      `${capitalize(role)} page is still marked as a non-publishable source or draft.`,
    );
  }
  if (AUTH_PAGE_PATTERN.test(html)) {
    throw new Error(
      `${capitalize(role)} page appears to be an authentication or challenge page.`,
    );
  }

  if (!visibleText.includes("joessh")) {
    throw new Error(`${capitalize(role)} page does not identify JoeSSH.`);
  }
  if (
    expectedPublisherName !== undefined &&
    !exactVisibleText.includes(expectedPublisherName)
  ) {
    throw new Error(
      `${capitalize(role)} page does not contain the exact verified publisher display name.`,
    );
  }
  for (const alternatives of REQUIRED_TEXT[role]) {
    if (!alternatives.some((term) => visibleText.includes(term))) {
      throw new Error(
        `${capitalize(role)} page is missing required ${alternatives[0]} content.`,
      );
    }
  }
  if (
    !/(?:last updated|effective date|\u6700\u540e\u66f4\u65b0|\u751f\u6548\u65e5\u671f)\D{0,40}\d{4}-\d{2}-\d{2}/i.test(
      visibleText,
    )
  ) {
    throw new Error(
      `${capitalize(role)} page is missing a visible ISO last-updated or effective date.`,
    );
  }
  assertRoleContactLink(role, html);
}

function assertRoleContactLink(role, html) {
  const markedLinks = [];
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const marker = readQuotedHtmlAttribute(tag, "data-joessh-contact");
    if (marker !== null) {
      markedLinks.push({
        href: readQuotedHtmlAttribute(tag, "href"),
        marker: marker.toLowerCase(),
      });
    }
  }
  const roleLinks = markedLinks.filter(({ marker }) => marker === role);
  if (roleLinks.length !== 1 || !roleLinks[0].href) {
    throw new Error(
      `${capitalize(role)} page must contain exactly one role-matched marked contact link.`,
    );
  }

  const href = roleLinks[0].href;
  if (
    href !== href.trim() ||
    /[\p{Cc}\p{Cf}]/u.test(href) ||
    PLACEHOLDER_PATTERN.test(href)
  ) {
    throw new Error(`${capitalize(role)} contact link is invalid.`);
  }
  if (href.startsWith("https://")) {
    parsePublicHttpsUrl(href, `${role} contact link`);
    return;
  }
  if (href.startsWith("mailto:")) {
    let address;
    try {
      const parsed = new URL(href);
      if (parsed.search || parsed.hash) throw new Error("unexpected suffix");
      address = decodeURIComponent(parsed.pathname);
    } catch (error) {
      throw new Error(`${capitalize(role)} email contact link is invalid.`, {
        cause: error,
      });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      throw new Error(`${capitalize(role)} email contact link is invalid.`);
    }
    return;
  }
  throw new Error(
    `${capitalize(role)} contact link must use public HTTPS or mailto.`,
  );
}

function readQuotedHtmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(
    new RegExp(`\\s${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return match?.[2] ?? null;
}

function extractVisibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolvePublicAddresses(url, lookupFn, resolvedHosts) {
  const hostname = normalizeHostname(url.hostname);
  if (resolvedHosts.has(hostname)) {
    return resolvedHosts.get(hostname);
  }
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    const records = [{ address: hostname, family: literalFamily }];
    resolvedHosts.set(hostname, records);
    return records;
  }
  let records;
  try {
    records = await lookupFn(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`DNS resolution failed for ${hostname}.`, { cause: error });
  }
  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    records.some(
      (record) =>
        !record ||
        typeof record.address !== "string" ||
        ![4, 6].includes(record.family) ||
        isIP(record.address) !== record.family ||
        !isPublicIpAddress(record.address),
    )
  ) {
    throw new Error(`${hostname} does not resolve only to public addresses.`);
  }
  const normalizedRecords = records.map(({ address, family }) => ({
    address: normalizeHostname(address),
    family,
  }));
  resolvedHosts.set(hostname, normalizedRecords);
  return normalizedRecords;
}

async function fetchBoundPublicPage(url, init, resolvedAddresses) {
  let lastError;
  for (const address of resolvedAddresses) {
    try {
      return await requestBoundAddress(url, init, address);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
    }
  }
  throw lastError ?? new Error("No validated public address was available.");
}

function requestBoundAddress(url, init, resolvedAddress) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpsRequest(
      url,
      {
        headers: init.headers,
        lookup: createPinnedLookup(resolvedAddress),
        method: "GET",
        signal: init.signal,
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) headers.append(name, item);
          } else if (value !== undefined) {
            headers.append(name, value);
          }
        }
        const status = incoming.statusCode ?? 0;
        const body = [204, 205, 304].includes(status)
          ? null
          : Readable.toWeb(incoming);
        try {
          resolveRequest(
            new Response(body, {
              headers,
              status,
              statusText: incoming.statusMessage ?? "",
            }),
          );
        } catch (error) {
          incoming.destroy();
          rejectRequest(error);
        }
      },
    );
    request.on("error", rejectRequest);
    request.end();
  });
}

export function createPinnedLookup(resolvedAddress) {
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [resolvedAddress]);
    } else {
      callback(null, resolvedAddress.address, resolvedAddress.family);
    }
  };
}

function looksLikeAuthenticationUrl(url) {
  let path;
  try {
    path = decodeURIComponent(`${url.hostname}${url.pathname}${url.search}`);
  } catch {
    path = `${url.hostname}${url.pathname}${url.search}`;
  }
  return AUTH_PATH_PATTERN.test(path);
}

function isPublicHostname(value) {
  const hostname = normalizeHostname(value);
  if (!hostname || hostname.includes("%")) {
    return false;
  }
  if (isIP(hostname)) {
    return isPublicIpAddress(hostname);
  }
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    return false;
  }
  const reservedSuffixes = [
    "arpa",
    "corp",
    "example",
    "home",
    "internal",
    "invalid",
    "lan",
    "local",
    "localdomain",
    "localhost",
    "onion",
    "test",
  ];
  return !(
    reservedSuffixes.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    ) ||
    ["example.com", "example.net", "example.org"].some(
      (example) => hostname === example || hostname.endsWith(`.${example}`),
    )
  );
}

function isPublicIpAddress(address) {
  const hostname = normalizeHostname(address);
  const version = isIP(hostname);
  if (version === 4) {
    return isPublicIpv4(hostname);
  }
  if (version === 6) {
    return isPublicIpv6(hostname);
  }
  return false;
}

function isPublicIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second, third] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPublicIpv6(hostname) {
  const hextets = parseIpv6(hostname);
  if (!hextets) {
    return false;
  }
  const [first, second] = hextets;
  const allZero = hextets.every((value) => value === 0);
  const loopback =
    hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1;
  const uniqueLocal = (first & 0xfe00) === 0xfc00;
  const linkLocal = (first & 0xffc0) === 0xfe80;
  const multicast = (first & 0xff00) === 0xff00;
  const documentation = first === 0x2001 && second === 0x0db8;
  const globalUnicast = (first & 0xe000) === 0x2000;
  const ipv4Mapped =
    hextets.slice(0, 5).every((value) => value === 0) && hextets[5] === 0xffff;
  const mappedPublic = ipv4Mapped
    ? isPublicIpv4(
        [
          hextets[6] >> 8,
          hextets[6] & 0xff,
          hextets[7] >> 8,
          hextets[7] & 0xff,
        ].join("."),
      )
    : true;
  return !(
    allZero ||
    loopback ||
    uniqueLocal ||
    linkLocal ||
    multicast ||
    documentation ||
    !globalUnicast ||
    !mappedPublic
  );
}

function parseIpv6(hostname) {
  const halves = hostname.split("::");
  if (halves.length > 2) {
    return null;
  }
  const parseHalf = (half) =>
    half === ""
      ? []
      : half.split(":").map((value) => {
          if (!/^[a-f0-9]{1,4}$/.test(value)) {
            return Number.NaN;
          }
          return Number.parseInt(value, 16);
        });
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if ([...left, ...right].some(Number.isNaN)) {
    return null;
  }
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - left.length - right.length;
  if (missing < 1) {
    return null;
  }
  return [...left, ...Array(missing).fill(0), ...right];
}

function normalizeHostname(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function assertExpectedPublisherName(value) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 3 ||
    value.length > 500 ||
    !/[\p{L}\p{N}]/u.test(value) ||
    /[\p{Cc}\p{Cf}]/u.test(value) ||
    PLACEHOLDER_PATTERN.test(value)
  ) {
    throw new Error(
      "The exact verified publisher display name is required through the private environment binding.",
    );
  }
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

export function parseArgs(args, env = process.env) {
  const options = {
    json: false,
    privacyUrl: env.JOESSH_PRIVACY_URL ?? "",
    publisherDisplayName: env.ATLASTERM_WINDOWS_LEGAL_PUBLISHER ?? "",
    supportUrl: env.JOESSH_SUPPORT_URL ?? "",
  };
  const valueOptions = new Map([
    ["--privacy-url", "privacyUrl"],
    ["--support-url", "supportUrl"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    const [flag, inlineValue] = arg.split(/=(.*)/s, 2);
    const key = valueOptions.get(flag);
    if (!key) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = inlineValue ?? args[index + 1];
    if (value === undefined || (!inlineValue && value.startsWith("--"))) {
      throw new Error(`${flag} requires a value.`);
    }
    options[key] = value;
    if (inlineValue === undefined) {
      index += 1;
    }
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `Store public page configuration error: ${error instanceof Error ? error.message : "Unknown failure."}`,
    );
    process.exitCode = 2;
    return;
  }
  const report = await checkStorePublicPages(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const page of report.pages) {
      if (page.ok) {
        console.log(
          `PASS ${capitalize(page.role)} public page - ${page.finalUrl} (${page.bytes} bytes, ${page.redirects.length} redirects)`,
        );
      } else {
        console.error(
          `FAIL ${capitalize(page.role)} public page - ${page.error}`,
        );
      }
    }
    console.log(`Store public page check: ${report.decision.toUpperCase()}.`);
  }
  process.exitCode = report.decision === "pass" ? 0 : 1;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  await main();
}
