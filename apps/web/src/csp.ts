export const WEB_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests";

export const WEB_HTTP_CONTENT_SECURITY_POLICY = `${WEB_CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`;

export const WEB_PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()";

const CONNECT_SRC_SELF = "connect-src 'self'";
const HTTP_SCHEME_PATTERN = /^https?:/i;
const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\/[^/\\\s]/i;
const HEAD_OPEN_PATTERN = /<head(\s[^>]*)?>/i;
const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
const META_ATTRIBUTE_PATTERN = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

export function getAdminSnapshotConnectOrigin(snapshotUrl?: string) {
  const normalizedUrl = snapshotUrl?.trim();

  if (
    !normalizedUrl ||
    normalizedUrl.startsWith('//') ||
    normalizedUrl.includes('\\') ||
    hasUnsafeUrlCharacter(normalizedUrl) ||
    hasMalformedAbsoluteHttpUrl(normalizedUrl)
  ) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return undefined;
    }
    if (parsedUrl.username || parsedUrl.password) {
      return undefined;
    }

    return parsedUrl.origin;
  } catch {
    return undefined;
  }
}

function hasMalformedAbsoluteHttpUrl(url: string) {
  return HTTP_SCHEME_PATTERN.test(url) && !ABSOLUTE_HTTP_URL_PATTERN.test(url);
}

export function createWebContentSecurityPolicy(snapshotUrl?: string) {
  const adminSnapshotOrigin = getAdminSnapshotConnectOrigin(snapshotUrl);

  if (!adminSnapshotOrigin) {
    return WEB_CONTENT_SECURITY_POLICY;
  }

  return WEB_CONTENT_SECURITY_POLICY.replace(CONNECT_SRC_SELF, `${CONNECT_SRC_SELF} ${adminSnapshotOrigin}`);
}

export function applyWebContentSecurityPolicy(html: string, snapshotUrl?: string) {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${createWebContentSecurityPolicy(snapshotUrl)}" />`;
  const cspMetaTag = findHttpEquivMetaTag(html, 'Content-Security-Policy');

  if (cspMetaTag) {
    return html.replace(cspMetaTag, cspMeta);
  }

  return injectHeadMeta(html, cspMeta);
}

export function applyPermissionsPolicy(html: string): string {
  const permissionsMeta = `<meta http-equiv="Permissions-Policy" content="${WEB_PERMISSIONS_POLICY}" />`;
  const permissionsMetaTag = findHttpEquivMetaTag(html, 'Permissions-Policy');

  if (permissionsMetaTag) {
    return html.replace(permissionsMetaTag, permissionsMeta);
  }

  // Inject after the existing CSP meta tag if no Permissions-Policy exists yet.
  // Preserve the CSP meta verbatim so any injected connect-src origin is kept.
  const cspMetaTag = findHttpEquivMetaTag(html, 'Content-Security-Policy');
  if (cspMetaTag) {
    return html.replace(cspMetaTag, `${cspMetaTag}\n    ${permissionsMeta}`);
  }

  return injectHeadMeta(html, permissionsMeta);
}

function injectHeadMeta(html: string, metaTag: string) {
  if (HEAD_OPEN_PATTERN.test(html)) {
    return html.replace(HEAD_OPEN_PATTERN, `$&\n    ${metaTag}`);
  }

  return `${metaTag}\n${html}`;
}

function findHttpEquivMetaTag(html: string, httpEquivValue: string) {
  for (const match of html.matchAll(META_TAG_PATTERN)) {
    const metaTag = match[0];
    if (getMetaAttribute(metaTag, 'http-equiv')?.toLowerCase() === httpEquivValue.toLowerCase()) {
      return metaTag;
    }
  }

  return undefined;
}

function getMetaAttribute(metaTag: string, attributeName: string) {
  META_ATTRIBUTE_PATTERN.lastIndex = 0;
  const normalizedAttributeName = attributeName.toLowerCase();

  for (const match of metaTag.matchAll(META_ATTRIBUTE_PATTERN)) {
    if (match[1].toLowerCase() === normalizedAttributeName) {
      return match[2] ?? match[3] ?? match[4];
    }
  }

  return undefined;
}

function hasControlOrFormatCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) || /\p{Cf}/u.test(character)) {
      return true;
    }
  }

  return false;
}

function hasUnsafeUrlCharacter(value: string) {
  return hasControlOrFormatCharacter(value) || /\s/u.test(value);
}
