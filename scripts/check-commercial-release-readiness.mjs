import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";

const REQUIRED_FILES = [
  ".github/FUNDING.yml",
  ".github/funding-operator-attestation.json",
  "README.md",
  "PRIVACY.md",
  "REFUND_POLICY.md",
  "SUPPORT.md",
  "TERMS_OF_SALE.md",
  "THIRD_PARTY_NOTICES.md",
  "TRADEMARKS.md",
  "docs/commercial-release-readiness.md",
  "docs/funding-and-checkout.md",
  "docs/pricing-hypotheses.md",
  "docs/voluntary-support.md",
  "docs/assets/funding/alipay-support-qr.jpg",
  "docs/assets/funding/wechat-support-qr.jpg",
];
const CUSTOMER_POLICIES = [
  "PRIVACY.md",
  "REFUND_POLICY.md",
  "SUPPORT.md",
  "TERMS_OF_SALE.md",
  "TRADEMARKS.md",
];
const STORE_POLICIES = ["PRIVACY.md", "SUPPORT.md"];
const PLACEHOLDER_PATTERN = /\{\{[A-Z0-9_]+\}\}/g;
const DRAFT_PATTERN =
  /\b(?:publication\s+status:\s*fail-closed(?:\s+Store)?\s+(?:draft|source)|fail-closed\s+commercial\s+draft|no\s+paid\s+offer\s+is\s+active|Store\s+release\s+support\s+route\s+is\s+still\s+blocked)\b/i;
const PAID_INACTIVE_PATTERN =
  /\b(?:not currently (?:available|for sale)|not currently an? (?:available )?offer|product hypotheses?, not currently available offers?)\b/i;
const UNVERIFIED_VALUE_PATTERN =
  /(?:change[-_ ]?me|example|placeholder|todo|tbd|unknown|not[-_ ]?set|verified_|<[^>]+>|\{\{)/i;
const FUNDING_ATTESTATION_PATH = ".github/funding-operator-attestation.json";
const FUNDING_ATTESTATION_MAX_AGE_DAYS = 180;
const REPOSITORY_VOLUNTARY_SUPPORT_URL =
  "https://github.com/JoeWorkspace/JoeSSH/blob/main/docs/voluntary-support.md";
const REPOSITORY_SUPPORT_ASSET_SHA256 = new Map([
  [
    "docs/assets/funding/wechat-support-qr.jpg",
    "2fed0d58be9eb25e14b696cd072e2aaf9ba9b1fc3fb08fe5a41e3840e686a062",
  ],
  [
    "docs/assets/funding/alipay-support-qr.jpg",
    "8921b976ab8f01c1aacb666947d13002244242ba3f0df8fab6de76d3b6f60d44",
  ],
]);
const FUNDING_ATTESTATION_KEYS = [
  "schemaVersion",
  "status",
  "fundingUrl",
  "verifiedAt",
  "checks",
];
const FUNDING_ATTESTATION_CHECK_KEYS = [
  "destinationOwnedByVerifiedOperator",
  "loggedOutPageReachable",
  "smallPaymentCompleted",
  "paymentLimitationsAndNonPurchaseWordingVerified",
  "payoutCompleted",
];
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const options = parseArgs(process.argv.slice(2));
const root = resolve(options.root ?? resolve(import.meta.dirname, ".."));
const checks = [];

for (const relativePath of REQUIRED_FILES) {
  addCheck(
    `file:${relativePath}`,
    existsSync(resolve(root, relativePath)),
    `${relativePath} exists`,
  );
}

if (checks.every((check) => check.ok)) {
  checkCommunityBoundary();
  checkFundingConfiguration();
  if (options.mode === "store") {
    checkStoreOperatorEvidence();
  } else if (options.mode === "paid") {
    checkPublishablePolicies(CUSTOMER_POLICIES);
    checkPaidOperatorEvidence();
  }
}

const failures = checks.filter((check) => !check.ok);
const report = {
  checks,
  decision: failures.length === 0 ? "pass" : "fail",
  generatedAt: new Date().toISOString(),
  mode: options.mode,
  schemaVersion: 1,
  summary: {
    fail: failures.length,
    pass: checks.length - failures.length,
  },
};

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const check of checks) {
    console.log(
      `${check.ok ? "PASS" : "FAIL"} ${check.label}${
        check.detail ? ` - ${check.detail}` : ""
      }`,
    );
  }
  console.log(
    `Commercial release readiness (${options.mode}): ${report.decision.toUpperCase()}.`,
  );
}

process.exit(failures.length === 0 ? 0 : 1);

function checkCommunityBoundary() {
  const support = readText("SUPPORT.md");
  const pricing = readText("docs/pricing-hypotheses.md");
  const terms = readText("TERMS_OF_SALE.md");
  addCheck(
    "community:license",
    /\bMIT(?:-licensed| License)\b/i.test(`${support}\n${pricing}\n${terms}`),
    "Community remains explicitly MIT-licensed",
  );
  addCheck(
    "community:free",
    /\bCommunity\b[\s\S]{0,100}\bfree\b/i.test(
      `${support}\n${pricing}\n${terms}`,
    ),
    "Community remains explicitly free",
  );
  if (options.mode === "community") {
    addCheck(
      "commercial:not-active",
      /\b(?:not currently (?:available|for sale)|no paid offer is active)\b/i.test(
        `${support}\n${terms}\n${readText("REFUND_POLICY.md")}`,
      ),
      "Unavailable paid offers are not presented as active",
    );
  }
}

function checkFundingConfiguration() {
  const funding = readText(".github/FUNDING.yml");
  const activeLines = funding
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const containsPlaceholder = activeLines.some((line) =>
    /(?:\{\{|VERIFIED_|CHANGE[-_ ]?ME|EXAMPLE|PLACEHOLDER)/i.test(line),
  );
  addCheck(
    "funding:no-placeholder",
    !containsPlaceholder,
    "Funding configuration contains no active placeholder",
    containsPlaceholder ? activeLines.join(" | ") : "",
  );
  const attestation = readCanonicalFundingAttestation();
  if (activeLines.length === 0) {
    const inactiveAttestation = isInactiveFundingAttestation(attestation);
    addCheck(
      "funding:attestation-inactive",
      inactiveAttestation,
      "Comments-only GitHub Funding uses the exact inactive persistent attestation",
      inactiveAttestation
        ? "No GitHub Sponsor button destination is activated."
        : "Keep the attestation inactive with a null URL/date and every verification check false.",
    );
    addCheck(
      "funding:community-boundary",
      inactiveAttestation,
      "Community candidate has no unverified GitHub Sponsor button destination",
    );
    checkFundingCliPreflight("");
    return;
  }

  const customFunding = funding.match(
    /^\s*custom:\s*\r?\n\s*-\s*(https:\/\/\S+)\s*$/m,
  );
  const configuredUrl = customFunding?.[1] ?? "";
  const exactMinimalConfig =
    activeLines.length === 2 &&
    activeLines[0] === "custom:" &&
    activeLines[1] === `- ${configuredUrl}`;
  addCheck(
    "funding:provider",
    exactMinimalConfig && isPublicHttpsUrl(configuredUrl),
    "Active funding uses exactly one valid HTTPS custom destination",
    exactMinimalConfig ? configuredUrl : activeLines.join(" | "),
  );
  if (configuredUrl === REPOSITORY_VOLUNTARY_SUPPORT_URL) {
    checkRepositoryVoluntarySupport(attestation);
    addCheck(
      "funding:cli-preflight-not-verified",
      !options.confirmFundingVerified && options.fundingUrl === "",
      "Repository-link funding cannot be represented as payment-verified by CLI flags",
      options.confirmFundingVerified || options.fundingUrl !== ""
        ? "Remove funding verification flags; repository-link intentionally retains false payment/operator checks."
        : "No payment verification is claimed.",
    );
    return;
  }
  const attestationStructure = hasFundingAttestationStructure(attestation);
  const attestationUrlBound =
    attestationStructure &&
    attestation.status === "verified" &&
    attestation.fundingUrl === configuredUrl &&
    isPublicHttpsUrl(attestation.fundingUrl);
  const attestationChecksComplete =
    attestationStructure &&
    FUNDING_ATTESTATION_CHECK_KEYS.every(
      (key) => attestation.checks[key] === true,
    );
  const verificationDate = attestationStructure
    ? parseIsoDateOnly(attestation.verifiedAt)
    : null;
  const today = utcDateStart(new Date());
  const verificationAgeDays =
    verificationDate === null
      ? null
      : Math.floor(
          (today.getTime() - verificationDate.getTime()) / MILLISECONDS_PER_DAY,
        );
  const attestationDateFresh =
    verificationAgeDays !== null &&
    verificationAgeDays >= 0 &&
    verificationAgeDays <= FUNDING_ATTESTATION_MAX_AGE_DAYS;

  addCheck(
    "funding:attestation-url",
    attestationUrlBound,
    "Persistent funding attestation exactly binds the active HTTPS destination",
    attestationUrlBound
      ? configuredUrl
      : "The verified attestation URL/status must exactly match .github/FUNDING.yml.",
  );
  addCheck(
    "funding:attestation-checks",
    attestationChecksComplete,
    "Persistent funding attestation confirms ownership, logged-out access, small payment, payment-limitations/non-purchase wording, and payout",
    attestationChecksComplete
      ? "All five operator checks are explicitly true."
      : "Every exact verification field must be present and true.",
  );
  addCheck(
    "funding:attestation-date",
    attestationDateFresh,
    `Persistent funding verification date is today or within the previous ${FUNDING_ATTESTATION_MAX_AGE_DAYS} days`,
    verificationAgeDays === null
      ? "verifiedAt must be a real YYYY-MM-DD UTC date."
      : verificationAgeDays < 0
        ? "verifiedAt must not be in the future."
        : verificationAgeDays > FUNDING_ATTESTATION_MAX_AGE_DAYS
          ? `Verification is ${verificationAgeDays} days old and must be repeated.`
          : `Verification is ${verificationAgeDays} day(s) old.`,
  );
  addCheck(
    "funding:operator-attestation",
    attestationUrlBound && attestationChecksComplete && attestationDateFresh,
    "Active funding is backed by a current committed operator attestation",
    attestationUrlBound && attestationChecksComplete && attestationDateFresh
      ? "Persistent non-secret evidence is complete; ordinary QA/CI needs no confirmation flag."
      : `Update ${FUNDING_ATTESTATION_PATH} only after repeating every live verification.`,
  );
  checkFundingCliPreflight(configuredUrl);
}

function checkRepositoryVoluntarySupport(attestation) {
  const repositoryLinkAttestation =
    isRepositoryLinkFundingAttestation(attestation);
  const supportPage = readText("docs/voluntary-support.md");
  const readme = readText("README.md");
  const normalizedSupportPage = supportPage
    .replace(/^\s*>\s?/gm, "")
    .replace(/\s+/g, " ");
  const pageBoundaryComplete = [
    /voluntary personal support, not a purchase/i,
    /(?:does not provide paid features|provides no rights beyond[\s\S]{0,120}paid features)/i,
    /personal Weixin Pay and\s+Alipay accounts/i,
    /cannot (?:use these personal collection\s+codes to )?cancel, reverse, refund, or automatically return/i,
    /GitHub(?:'s)? Sponsor button only links to this notice/i,
    /GitHub does not process\s+these payments/i,
    /recipient, small-payment, and payout verification (?:is|are) not\s+complete/i,
  ].every((pattern) => pattern.test(normalizedSupportPage));
  const exactAssetsLinked = [
    'href="assets/funding/wechat-support-qr.jpg"',
    'href="assets/funding/alipay-support-qr.jpg"',
  ].every((value) => supportPage.includes(value));
  const exactAssetsPinned = [...REPOSITORY_SUPPORT_ASSET_SHA256].every(
    ([relativePath, expected]) => sha256File(relativePath) === expected,
  );
  const normalizedReadme = readme
    .replace(/^\s*>\s?/gm, "")
    .replace(/\s+/g, " ");
  const readmeBoundaryComplete = [
    /GitHub(?:'s)? Sponsor button only links to the voluntary-support notice/i,
    /GitHub does not process these payments/i,
    /recipient, small-payment, and payout verification (?:is|are) not complete/i,
  ].every((pattern) => pattern.test(normalizedReadme));

  addCheck(
    "funding:repository-support-page",
    pageBoundaryComplete && exactAssetsLinked && readmeBoundaryComplete,
    "Repository Sponsor link targets the reviewed voluntary-support page",
    pageBoundaryComplete && exactAssetsLinked && readmeBoundaryComplete
      ? REPOSITORY_VOLUNTARY_SUPPORT_URL
      : "Keep the non-purchase/payment-limitations/unverified wording and both reviewed QR references on the support page and README.",
  );
  addCheck(
    "funding:repository-support-assets",
    exactAssetsPinned,
    "Repository support-page QR assets match the reviewed SHA-256 pins",
    exactAssetsPinned
      ? "Both public QR assets are byte-for-byte unchanged."
      : "A QR asset changed; review the payment destination and update pins only with explicit operator approval.",
  );
  addCheck(
    "funding:attestation-repository-link",
    repositoryLinkAttestation,
    "Repository support-page funding uses the exact unverified-link payment-operator attestation",
    repositoryLinkAttestation
      ? "No small-payment, recipient, or payout verification is claimed."
      : "Bind the exact repository support URL with repository-link-unverified status, a null date, and every payment verification check false.",
  );
  addCheck(
    "funding:community-boundary",
    pageBoundaryComplete &&
      exactAssetsLinked &&
      exactAssetsPinned &&
      repositoryLinkAttestation,
    "Sponsor link remains voluntary support and does not activate checkout or paid benefits",
  );
}

function readCanonicalFundingAttestation() {
  const raw = readText(FUNDING_ATTESTATION_PATH);
  let value = null;
  let parsed = false;
  try {
    value = JSON.parse(raw);
    parsed = true;
  } catch {
    // Stable check below.
  }
  const canonical = parsed && raw === `${JSON.stringify(value, null, 2)}\n`;
  addCheck(
    "funding:attestation-json",
    canonical,
    "Funding operator attestation is strict canonical JSON",
    canonical
      ? FUNDING_ATTESTATION_PATH
      : "Use UTF-8 JSON with two-space indentation, one terminal newline, no duplicate/extra representation, and no comments.",
  );
  return canonical ? value : null;
}

function hasFundingAttestationStructure(value) {
  const valid =
    isRecord(value) &&
    hasExactKeys(value, FUNDING_ATTESTATION_KEYS) &&
    value.schemaVersion === 1 &&
    ["inactive", "repository-link-unverified", "verified"].includes(
      value.status,
    ) &&
    isRecord(value.checks) &&
    hasExactKeys(value.checks, FUNDING_ATTESTATION_CHECK_KEYS) &&
    FUNDING_ATTESTATION_CHECK_KEYS.every(
      (key) => typeof value.checks[key] === "boolean",
    );
  addCheck(
    "funding:attestation-structure",
    valid,
    "Funding operator attestation has only the reviewed schema and exact verification fields",
  );
  return valid;
}

function isInactiveFundingAttestation(value) {
  return (
    hasFundingAttestationStructure(value) &&
    value.status === "inactive" &&
    value.fundingUrl === null &&
    value.verifiedAt === null &&
    FUNDING_ATTESTATION_CHECK_KEYS.every((key) => value.checks[key] === false)
  );
}

function isRepositoryLinkFundingAttestation(value) {
  return (
    hasFundingAttestationStructure(value) &&
    value.status === "repository-link-unverified" &&
    value.fundingUrl === REPOSITORY_VOLUNTARY_SUPPORT_URL &&
    value.verifiedAt === null &&
    FUNDING_ATTESTATION_CHECK_KEYS.every((key) => value.checks[key] === false)
  );
}

function checkFundingCliPreflight(configuredUrl) {
  const supplied = options.confirmFundingVerified || options.fundingUrl !== "";
  if (!supplied) {
    return;
  }
  const valid =
    options.confirmFundingVerified &&
    isPublicHttpsUrl(options.fundingUrl) &&
    (configuredUrl === "" || options.fundingUrl === configuredUrl);
  addCheck(
    "funding:cli-preflight",
    valid,
    "Optional one-time funding CLI preflight is complete and URL-bound",
    valid
      ? "CLI confirmation is diagnostic only and does not replace the committed attestation."
      : "Supply both --funding-url and --confirm-funding-verified; an active URL must match exactly.",
  );
}

function parseIsoDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

function utcDateStart(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index])
  );
}

function checkPublishablePolicies(relativePaths) {
  for (const relativePath of relativePaths) {
    const text = readText(relativePath);
    const placeholders = [...new Set(text.match(PLACEHOLDER_PATTERN) ?? [])];
    addCheck(
      `policy:${relativePath}:placeholders`,
      placeholders.length === 0,
      `${relativePath} has no unresolved customer-facing placeholders`,
      placeholders.join(", "),
    );
    addCheck(
      `policy:${relativePath}:draft`,
      !DRAFT_PATTERN.test(text),
      `${relativePath} is no longer marked as an inactive or blocked draft`,
    );
  }
}

function checkStoreOperatorEvidence() {
  checkRealValue("store:seller", options.sellerName, "Store seller legal name");
  if (options.mode === "store") {
    checkRealValue(
      "store:windows-legal-publisher",
      options.windowsLegalPublisher,
      "Protected Windows legal publisher",
    );
    addCheck(
      "store:seller-publisher-binding",
      isRealValue(options.sellerName) &&
        options.sellerName === options.windowsLegalPublisher,
      "Store seller legal name exactly matches the protected Windows legal publisher",
      isRealValue(options.sellerName) &&
        isRealValue(options.windowsLegalPublisher) &&
        options.sellerName === options.windowsLegalPublisher
        ? "Exact legal identity binding supplied."
        : "Supply one canonical local Partner Center identity through the Store wrapper, or set both protected identity environment values to the same truthful legal identity.",
    );
  }
  checkPublicUrl(
    "store:support-url",
    options.supportUrl,
    "Published support URL",
  );
  checkPublicUrl(
    "store:privacy-url",
    options.privacyUrl,
    "Published privacy URL",
  );
  addCheck(
    "store:public-links-confirmed",
    options.confirmPublicLinks,
    "Seller identity and logged-out support/privacy links are operator-confirmed",
    options.confirmPublicLinks
      ? "Operator attestation supplied."
      : "Rerun with --confirm-public-links only after logged-out verification.",
  );

  if (options.mode === "store" && isRealValue(options.sellerName)) {
    const trackedStorePolicies = STORE_POLICIES.map(readText).join("\n");
    addCheck(
      "store:publisher-identity-not-tracked",
      !trackedStorePolicies.includes(options.sellerName),
      "Personal Store publisher identity stays out of tracked policy sources",
      trackedStorePolicies.includes(options.sellerName)
        ? "Remove the personal publisher identity from tracked policy files and render the public Store pages from a private staging copy."
        : "The logged-out public-page checker owns exact publisher-name binding without committing the name.",
    );
  }
}

function checkPaidOperatorEvidence() {
  checkStoreOperatorEvidence();
  const acceptedEuMarketScopes = [
    "not-offered",
    "business-only",
    "consumer-microenterprise-exempt",
    "consumer-in-scope",
  ];
  const euMarketScopeAccepted = acceptedEuMarketScopes.includes(
    options.euMarketScope,
  );
  addCheck(
    "paid:eu-market-scope",
    euMarketScopeAccepted,
    "EU paid distribution scope is explicitly classified",
    euMarketScopeAccepted
      ? options.euMarketScope
      : `Choose exactly one of: ${acceptedEuMarketScopes.join(", ")}.`,
  );
  addCheck(
    "paid:eu-accessibility-assessed",
    euMarketScopeAccepted && options.confirmEuAccessibilityAssessed,
    "EAA and applicable national accessibility scope were reassessed before paid launch",
    euMarketScopeAccepted && options.confirmEuAccessibilityAssessed
      ? "Operator assessment supplied."
      : "Classify the EU market scope and confirm the documented assessment; do not infer an exemption from price or company size alone.",
  );
  checkRealValue(
    "paid:merchant-of-record",
    options.merchantOfRecord,
    "Merchant of record legal name",
  );
  checkRealValue(
    "paid:governing-law",
    options.governingLaw,
    "Governing law and mandatory consumer disclosure",
  );
  checkPublicUrl(
    "paid:checkout-url",
    options.checkoutUrl,
    "Published checkout URL",
  );
  checkPublicUrl(
    "paid:customer-portal-url",
    options.customerPortalUrl,
    "Published customer portal URL",
  );
  addCheck(
    "paid:live-flow-confirmed",
    options.confirmLiveCommerce,
    "Real purchase, delivery, recovery, cancellation, refund, failed-payment, payout, and tax-record flows are operator-confirmed",
    options.confirmLiveCommerce
      ? "Operator attestation supplied."
      : "Rerun with --confirm-live-commerce only after the live end-to-end drills.",
  );

  const policyText = CUSTOMER_POLICIES.map(readText).join("\n");
  addCheck(
    "paid:offer-active",
    !PAID_INACTIVE_PATTERN.test(policyText),
    "Customer policies no longer describe the paid offer as unavailable",
  );
  if (
    isRealValue(options.sellerName) &&
    isRealValue(options.merchantOfRecord) &&
    isRealValue(options.governingLaw) &&
    isPublicHttpsUrl(options.supportUrl) &&
    isPublicHttpsUrl(options.customerPortalUrl)
  ) {
    const terms = readText("TERMS_OF_SALE.md");
    const refunds = readText("REFUND_POLICY.md");
    const privacy = readText("PRIVACY.md");
    const support = readText("SUPPORT.md");
    addCheck(
      "paid:policy-binding",
      terms.includes(options.sellerName) &&
        terms.includes(options.merchantOfRecord) &&
        terms.includes(options.governingLaw) &&
        privacy.includes(options.sellerName) &&
        privacy.includes(options.merchantOfRecord) &&
        support.includes(options.supportUrl) &&
        refunds.includes(options.supportUrl) &&
        refunds.includes(options.customerPortalUrl),
      "Seller, merchant, law, support, and customer-portal evidence is bound into the policy set",
    );
  }
}

function checkRealValue(id, value, label) {
  addCheck(
    id,
    isRealValue(value),
    `${label} is explicit and non-placeholder`,
    isRealValue(value)
      ? "Value supplied and validated without echoing it."
      : "Missing or placeholder value.",
  );
}

function checkPublicUrl(id, value, label) {
  addCheck(
    id,
    isPublicHttpsUrl(value),
    `${label} is a public HTTPS URL`,
    isPublicHttpsUrl(value) ? value : "Missing, placeholder, or invalid URL.",
  );
}

function isRealValue(value) {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= 3 &&
    value.length <= 500 &&
    /[\p{L}\p{N}]/u.test(value) &&
    !/[\p{Cc}\p{Cf}]/u.test(value) &&
    !UNVERIFIED_VALUE_PATTERN.test(value)
  );
}

function isPublicHttpsUrl(value) {
  if (!isRealValue(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      isPublicHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

function isPublicHostname(value) {
  const hostname = value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!hostname || hostname.includes("%")) {
    return false;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return isPublicIpv4(hostname);
  }
  if (ipVersion === 6) {
    return isPublicIpv6(hostname);
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
    "example",
    "invalid",
    "localhost",
    "local",
    "localdomain",
    "test",
    "internal",
    "home",
    "lan",
    "corp",
    "onion",
    "arpa",
  ];
  if (
    reservedSuffixes.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    ) ||
    ["example.com", "example.net", "example.org"].some(
      (example) => hostname === example || hostname.endsWith(`.${example}`),
    )
  ) {
    return false;
  }

  return true;
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

function readText(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8").replace(
    /^\uFEFF/,
    "",
  );
}

function sha256File(relativePath) {
  return createHash("sha256")
    .update(readFileSync(resolve(root, relativePath)))
    .digest("hex");
}

function addCheck(id, ok, label, detail = "") {
  checks.push({ detail, id, label, ok });
}

function parseArgs(args) {
  const valueOptions = new Map([
    ["--checkout-url", "checkoutUrl"],
    ["--customer-portal-url", "customerPortalUrl"],
    ["--eu-market-scope", "euMarketScope"],
    ["--funding-url", "fundingUrl"],
    ["--governing-law", "governingLaw"],
    ["--merchant-of-record", "merchantOfRecord"],
    ["--privacy-url", "privacyUrl"],
    ["--seller-name", "sellerName"],
    ["--support-url", "supportUrl"],
    ["--windows-legal-publisher", "windowsLegalPublisher"],
  ]);
  const values = {
    checkoutUrl: process.env.JOESSH_CHECKOUT_URL ?? "",
    customerPortalUrl: process.env.JOESSH_CUSTOMER_PORTAL_URL ?? "",
    euMarketScope: process.env.JOESSH_EU_MARKET_SCOPE ?? "",
    fundingUrl: process.env.JOESSH_FUNDING_URL ?? "",
    governingLaw: process.env.JOESSH_GOVERNING_LAW ?? "",
    merchantOfRecord: process.env.JOESSH_MERCHANT_OF_RECORD ?? "",
    privacyUrl: process.env.JOESSH_PRIVACY_URL ?? "",
    sellerName: process.env.JOESSH_SELLER_LEGAL_NAME ?? "",
    supportUrl: process.env.JOESSH_SUPPORT_URL ?? "",
    windowsLegalPublisher: process.env.ATLASTERM_WINDOWS_LEGAL_PUBLISHER ?? "",
  };
  let confirmFundingVerified = false;
  let confirmEuAccessibilityAssessed = false;
  let confirmLiveCommerce = false;
  let confirmPublicLinks = false;
  let json = false;
  let mode = "community";
  let rootValue = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--confirm-funding-verified") {
      confirmFundingVerified = true;
      continue;
    }
    if (arg === "--confirm-eu-accessibility-assessed") {
      confirmEuAccessibilityAssessed = true;
      continue;
    }
    if (arg === "--confirm-live-commerce") {
      confirmLiveCommerce = true;
      continue;
    }
    if (arg === "--confirm-public-links") {
      confirmPublicLinks = true;
      continue;
    }
    if (arg === "--mode") {
      mode = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--root") {
      rootValue = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      rootValue = arg.slice("--root=".length);
      continue;
    }
    const [flag, inlineValue] = arg.split(/=(.*)/s, 2);
    if (valueOptions.has(flag)) {
      values[valueOptions.get(flag)] =
        inlineValue ?? readValue(args, index, flag);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }
    failArgument(`Unknown argument: ${arg}`);
  }
  if (!["community", "paid", "store"].includes(mode)) {
    failArgument("--mode must be community, paid, or store.");
  }
  return {
    confirmEuAccessibilityAssessed,
    confirmFundingVerified,
    confirmLiveCommerce,
    confirmPublicLinks,
    json,
    mode,
    root: rootValue,
    ...values,
  };
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    failArgument(`${flag} requires a value.`);
  }
  return value;
}

function failArgument(message) {
  console.error(message);
  process.exit(2);
}
