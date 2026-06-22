import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const productionSources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./vite-env.d.ts'], {
  eager: true,
  import: 'default',
  query: '?raw',
});

const webRootPath = fileURLToPath(new URL('..', import.meta.url));
const shellSourceExtensionlessFiles = new Set(['_headers']);
const shellSourceExtensions = new Set(['.html', '.js', '.json', '.svg', '.txt']);

type StaticFallbackShellContract = {
  sourcePath: string;
  titleText: string;
  iconText: string;
  headingText: string;
  descriptionText: string;
  actionText: string;
  actionHref: string;
  actionLinkSource: string;
  actionSelector: string;
  statusText?: string;
};

const staticFallbackShellContracts: StaticFallbackShellContract[] = [
  {
    sourcePath: '../public/404.html',
    titleText: 'JoeSSH — Page Not Found',
    iconText: '🔍',
    statusText: '404',
    headingText: 'Page not found',
    descriptionText: "The page you're looking for doesn't exist or has been moved.",
    actionText: 'Go to Dashboard',
    actionHref: '/',
    actionLinkSource: '<a href="/">Go to Dashboard</a>',
    actionSelector: 'a',
  },
  {
    sourcePath: '../public/offline.html',
    titleText: 'JoeSSH — Offline',
    iconText: '📡',
    headingText: "You're offline",
    descriptionText: 'JoeSSH Admin requires an internet connection. Please check your network and try again.',
    actionText: 'Retry Connection',
    actionHref: '/',
    actionLinkSource: '<a class="retry-link" href="/">Retry Connection</a>',
    actionSelector: '.retry-link',
  },
];
const staticFallbackShellSourcePaths = new Set(staticFallbackShellContracts.map(({ sourcePath }) => sourcePath));
const staticFallbackActionStyleNeedles = [
  'display: inline-block;',
  'background: #238636;',
  'color: #fff;',
  'min-height: 44px;',
  'min-width: 44px;',
  'max-width: 100%;',
  'padding: 0.75rem 1.5rem;',
  'border-radius: 6px;',
  'font-size: 1rem;',
  'font-weight: 500;',
  'line-height: 1.2;',
  'text-decoration: none;',
  'white-space: normal;',
  'transition: background 0.2s;',
  'background: #2ea043;',
];
const staticFallbackPageFrameStyleNeedles = [
  'display: flex;',
  'align-items: center;',
  'justify-content: center;',
  'min-height: 100vh;',
  'font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;',
  'background: #0d1117;',
  'color: #e6edf3;',
  'text-align: center;',
  'padding: 2rem;',
  'width: 100%;',
  'max-width: 400px;',
  'overflow-wrap: anywhere;',
  'font-size: 1.5rem;',
  'font-weight: 600;',
  'color: #8b949e;',
  'line-height: 1.6;',
];
const staticFallbackIconStyleNeedles = ['font-size: 3rem;', 'margin-bottom: 1rem;'];
const staticFallbackStatusCodeStyleNeedles = [
  'color: #6e7681;',
  'font-size: 0.875rem;',
  'font-weight: 700;',
  'letter-spacing: 0.08em;',
  'text-transform: uppercase;',
  'margin-bottom: 0.5rem;',
];
const staticFallbackDocumentShellPatterns = [
  { label: 'doctype', pattern: /<!doctype html>/g },
  { label: 'html language', pattern: /<html lang="en">/g },
  { label: 'head open', pattern: /<head>/g },
  { label: 'head close', pattern: /<\/head>/g },
  { label: 'body open', pattern: /<body>/g },
  { label: 'body close', pattern: /<\/body>/g },
  { label: 'html close', pattern: /<\/html>/g },
  { label: 'charset meta', pattern: /<meta charset="UTF-8" \/>/g },
  {
    label: 'viewport meta',
    pattern: /<meta name="viewport" content="width=device-width, initial-scale=1\.0" \/>/g,
  },
  { label: 'theme-color meta', pattern: /<meta name="theme-color" content="#101820" \/>/g },
  { label: 'color-scheme meta', pattern: /<meta name="color-scheme" content="dark light" \/>/g },
  {
    label: 'referrer meta',
    pattern: /<meta name="referrer" content="strict-origin-when-cross-origin" \/>/g,
  },
];
const staticFallbackSecurityMetaPatterns = [
  {
    label: 'content security policy meta',
    pattern:
      /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; upgrade-insecure-requests" \/>/g,
  },
  {
    label: 'content type options meta',
    pattern: /<meta http-equiv="X-Content-Type-Options" content="nosniff" \/>/g,
  },
  {
    label: 'permissions policy meta',
    pattern:
      /<meta http-equiv="Permissions-Policy" content="camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\), magnetometer=\(\), gyroscope=\(\), accelerometer=\(\)" \/>/g,
  },
];
const staticAppShellDocumentPatterns = [
  { label: 'doctype', pattern: /<!doctype html>/g },
  { label: 'html language', pattern: /<html lang="en">/g },
  { label: 'head open', pattern: /<head>/g },
  { label: 'head close', pattern: /<\/head>/g },
  { label: 'body open', pattern: /<body>/g },
  { label: 'body close', pattern: /<\/body>/g },
  { label: 'html close', pattern: /<\/html>/g },
  { label: 'charset meta', pattern: /<meta charset="UTF-8" \/>/g },
  {
    label: 'viewport meta',
    pattern: /<meta name="viewport" content="width=device-width, initial-scale=1\.0" \/>/g,
  },
  {
    label: 'description meta',
    pattern:
      /<meta name="description" content="JoeSSH Admin Console [^"]*team management, device status, audit logs, and sync operations\." \/>/g,
  },
  { label: 'theme-color meta', pattern: /<meta name="theme-color" content="#101820" \/>/g },
  { label: 'color-scheme meta', pattern: /<meta name="color-scheme" content="dark light" \/>/g },
  {
    label: 'apple mobile capable meta',
    pattern: /<meta name="apple-mobile-web-app-capable" content="yes" \/>/g,
  },
  {
    label: 'apple status bar meta',
    pattern: /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/g,
  },
  {
    label: 'content security policy meta',
    pattern:
      /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests" \/>/g,
  },
  {
    label: 'permissions policy meta',
    pattern:
      /<meta http-equiv="Permissions-Policy" content="camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\), magnetometer=\(\), gyroscope=\(\), accelerometer=\(\)" \/>/g,
  },
  {
    label: 'referrer meta',
    pattern: /<meta name="referrer" content="strict-origin-when-cross-origin" \/>/g,
  },
  {
    label: 'content type options meta',
    pattern: /<meta http-equiv="X-Content-Type-Options" content="nosniff" \/>/g,
  },
  { label: 'open graph title', pattern: /<meta property="og:title" content="JoeSSH Admin" \/>/g },
  {
    label: 'open graph description',
    pattern: /<meta property="og:description" content="Team management, device status, audit logs, and sync operations\." \/>/g,
  },
  { label: 'open graph type', pattern: /<meta property="og:type" content="website" \/>/g },
  { label: 'twitter card', pattern: /<meta name="twitter:card" content="summary" \/>/g },
  { label: 'twitter title', pattern: /<meta name="twitter:title" content="JoeSSH Admin" \/>/g },
  {
    label: 'twitter description',
    pattern: /<meta name="twitter:description" content="Team management, device status, audit logs, and sync operations\." \/>/g,
  },
  { label: 'document title', pattern: /<title>JoeSSH Admin<\/title>/g },
];
const staticManifestExpectedShortcuts = [
  {
    name: 'Team Dashboard',
    short_name: 'Team',
    url: '/#team',
  },
  {
    name: 'Device Status',
    short_name: 'Devices',
    url: '/#devices',
  },
  {
    name: 'Audit Log',
    short_name: 'Audit',
    url: '/#audit',
  },
];
const staticFaviconExpectedSource = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
  '  <rect width="32" height="32" rx="6" fill="#101820"/>',
  '  <path d="M8 22V10h10v3H11.5v2.5h5v3h-5V22H8z" fill="#3467eb"/>',
  '  <path d="M19 10h4v12h-3.5v-8.5H19V10z" fill="#ffffff"/>',
  '</svg>',
].join('\n');
const staticDeploymentHeadersExpectedSource = [
  '/*',
  "  Content-Security-Policy: frame-ancestors 'none'",
  '  X-Frame-Options: DENY',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
].join('\n');
const staticRobotsTxtExpectedSource = ['User-agent: *', 'Allow: /'].join('\n');
const staticHumansTxtExpectedSource = [
  '/* TEAM */',
  'JoeSSH Team',
  '',
  '/* SITE */',
  'Standards: HTML5, CSS3, ES2020, WCAG 2.1 AA',
  'Components: React 19, TypeScript, Vite',
  'Software: VS Code, Figma',
].join('\n');
const staticSecurityTxtExpectedSource = [
  'Contact: mailto:security@atlasterm.dev',
  'Expires: 2027-05-31T00:00:00.000Z',
  'Encryption: https://atlasterm.dev/.well-known/pgp-key.txt',
  'Acknowledgments: https://atlasterm.dev/security/acknowledgments',
  'Preferred-Languages: en, zh',
  'Canonical: https://atlasterm.dev/.well-known/security.txt',
  'Policy: https://atlasterm.dev/security/policy',
].join('\n');
const staticShellExpectedSourcePaths = [
  '../index.html',
  '../public/.well-known/security.txt',
  '../public/404.html',
  '../public/_headers',
  '../public/favicon.svg',
  '../public/humans.txt',
  '../public/manifest.json',
  '../public/offline.html',
  '../public/robots.txt',
  '../public/sw.js',
];
const staticNonServiceWorkerShellExpectedSourcePaths = staticShellExpectedSourcePaths.filter(
  (sourcePath) => sourcePath !== '../public/sw.js',
);
const staticShellSourceByteBudgets: Record<string, number> = {
  '../index.html': 4096,
  '../public/.well-known/security.txt': 1024,
  '../public/404.html': 4096,
  '../public/_headers': 512,
  '../public/favicon.svg': 512,
  '../public/humans.txt': 512,
  '../public/manifest.json': 2048,
  '../public/offline.html': 4096,
  '../public/robots.txt': 128,
  '../public/sw.js': 4096,
};
const staticServiceWorkerExpectedEventTypes = ['install', 'activate', 'fetch'];
const staticServiceWorkerCachePolicyNeedles = [
  "const CACHE_NAME = 'joessh-admin-v1';",
  'const MAX_CACHE_ENTRIES = 100;',
  "const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/favicon.svg', '/offline.html'];",
  'caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()),',
  '.then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))',
  '.then(() => self.clients.claim()),',
  "if (request.method !== 'GET') {",
  'if (url.origin !== self.location.origin) {',
  "const isManifest = url.pathname === '/manifest.json';",
  'if (!isStaticAsset && !isNavigation && !isManifest) {',
  'event.respondWith(',
  'fetch(request)',
  "cached || caches.match('/').then((root) =>",
  "root || caches.match('/offline.html').then((offline) =>",
  "offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })",
  'event.respondWith(staleWhileRevalidate(request));',
  'async function staleWhileRevalidate(request) {',
  'async function trimCache(cache) {',
  'if (keys.length > MAX_CACHE_ENTRIES) {',
  'await cache.delete(keys[0]);',
];
const staticShellMojibakePatterns = [
  { label: 'replacement character', pattern: /\uFFFD/ },
  { label: 'double-decoded replacement marker', pattern: /锟斤拷/ },
  { label: 'UTF-8 punctuation mojibake', pattern: /鈥[?\uFFFD]?/ },
  { label: 'emoji mojibake', pattern: /馃/ },
  { label: 'Latin-1 UTF-8 mojibake', pattern: /(?:Ã.|Â.|â[€™€œ€“])/ },
];

function collectShellSources(rootPath: string, displayPrefix: string): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = join(rootPath, entry.name);
    const displayPath = `${displayPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(sources, collectShellSources(entryPath, displayPath));
      continue;
    }

    if (shellSourceExtensions.has(extname(entry.name)) || shellSourceExtensionlessFiles.has(entry.name)) {
      sources[displayPath] = readFileSync(entryPath, 'utf-8');
    }
  }
  return sources;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stringLiteralPattern(value: string): string {
  return String.raw`['"\`]${escapeRegExp(value)}['"\`]`;
}

function stringLiteralExpressionPattern(value: string): string {
  const literalPatterns = [stringLiteralPattern(value)];
  for (let splitIndex = 1; splitIndex < value.length; splitIndex += 1) {
    const prefix = value.slice(0, splitIndex);
    const suffix = value.slice(splitIndex);
    literalPatterns.push(
      `${stringLiteralPattern(prefix)}\\s*\\+\\s*${stringLiteralPattern(suffix)}`,
      String.raw`\`${escapeRegExp(prefix)}\$\{\s*${stringLiteralPattern(suffix)}\s*\}\``,
      String.raw`\`\$\{\s*${stringLiteralPattern(prefix)}\s*\}${escapeRegExp(suffix)}\``,
    );
  }
  for (let prefixEnd = 1; prefixEnd < value.length - 1; prefixEnd += 1) {
    for (let suffixStart = prefixEnd + 1; suffixStart < value.length; suffixStart += 1) {
      literalPatterns.push(
        String.raw`\`${escapeRegExp(value.slice(0, prefixEnd))}\$\{\s*${stringLiteralPattern(
          value.slice(prefixEnd, suffixStart),
        )}\s*\}${escapeRegExp(value.slice(suffixStart))}\``,
      );
    }
  }

  return `(?:${literalPatterns.join('|')})`;
}

function objectPropertyPatterns(objectName: string, propertyName: string): RegExp[] {
  const escapedObjectName = escapeRegExp(objectName);
  const escapedPropertyName = escapeRegExp(propertyName);
  const propertyExpression = stringLiteralExpressionPattern(propertyName);
  const platformObjectExpression = String.raw`\b(?:window|globalThis|self)\b`;
  const objectExpression =
    objectName === 'window'
      ? platformObjectExpression
      : String.raw`(?:(?:${platformObjectExpression}\s*(?:\.|\?\.)\s*)?\b${escapedObjectName}\b|${platformObjectExpression}\s*(?:\?\.)?\[\s*${stringLiteralExpressionPattern(
          objectName,
        )}\s*\])`;
  const objectReference = String.raw`(?:\(?\s*(?:${objectExpression})(?:\s+as\s+[^)\]\n;]+)?\s*\)?)`;
  const propertyAccess = String.raw`(?:(?:\.|\?\.)\s*${escapedPropertyName}\b|(?:\?\.)?\[\s*${propertyExpression}\s*\])`;
  return [
    new RegExp(String.raw`${objectReference}\s*${propertyAccess}`),
    new RegExp(String.raw`\{[^}]*\b${escapedPropertyName}\b[^}]*\}\s*=\s*${objectReference}`),
    new RegExp(
      String.raw`\{[^}]*\b${escapedObjectName}\s*:\s*([A-Za-z_$][\w$]*)[^}]*\}\s*=\s*${platformObjectExpression}\s*;[\s\S]{0,1200}\b\1\s*${propertyAccess}`,
    ),
    new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${objectReference}\s*;[\s\S]{0,1200}\b\1\s*${propertyAccess}`),
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${propertyExpression}\s*;[\s\S]{0,1200}${objectReference}\s*(?:\?\.)?\[\s*\1\s*\]`,
    ),
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${objectReference}\s*;[\s\S]{0,1200}\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${propertyExpression}\s*;[\s\S]{0,1200}\b\1\s*(?:\?\.)?\[\s*\2\s*\]`,
    ),
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${propertyExpression}\s*;[\s\S]{0,1200}\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${objectReference}\s*;[\s\S]{0,1200}\b\2\s*(?:\?\.)?\[\s*\1\s*\]`,
    ),
  ];
}

function methodCallPatterns(methodName: string): RegExp[] {
  const escapedMethodName = escapeRegExp(methodName);
  const methodExpression = stringLiteralExpressionPattern(methodName);
  const objectReference = String.raw`(?:\(?\s*[A-Za-z_$][\w$]*(?:(?:\.|\?\.)\s*[A-Za-z_$][\w$]*|(?:\?\.)?\[\s*[^\]\n;]{1,80}\s*\])*(?:\s+as\s+[^)\]\n;]+)?\s*\)?)`;
  const methodCall = String.raw`\s*(?:\?\.)?\s*\(`;

  return [
    new RegExp(String.raw`(?:\.|\?\.)\s*${escapedMethodName}\b${methodCall}`),
    new RegExp(String.raw`${objectReference}\s*(?:\?\.)?\[\s*${methodExpression}\s*\]${methodCall}`),
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${methodExpression}\s*;[\s\S]{0,1200}${objectReference}\s*(?:\?\.)?\[\s*\1\s*\]${methodCall}`,
    ),
    new RegExp(
      String.raw`\{[^}]*\b(${escapedMethodName})\b[^}]*\}\s*=\s*${objectReference}\s*;[\s\S]{0,1200}\b\1\s*\(`,
    ),
    new RegExp(
      String.raw`\{[^}]*\b${escapedMethodName}\s*:\s*([A-Za-z_$][\w$]*)[^}]*\}\s*=\s*${objectReference}\s*;[\s\S]{0,1200}\b\1\s*\(`,
    ),
  ];
}

function propertyAccessPatterns(propertyName: string): RegExp[] {
  const escapedPropertyName = escapeRegExp(propertyName);
  const propertyExpression = stringLiteralExpressionPattern(propertyName);
  const objectReference = String.raw`(?:\(?\s*[A-Za-z_$][\w$]*(?:(?:\.|\?\.)\s*[A-Za-z_$][\w$]*|(?:\?\.)?\[\s*[^\]\n;]{1,80}\s*\])*(?:\s+as\s+[^)\]\n;]+)?\s*\)?)`;
  const propertyAccess = String.raw`(?:(?:\.|\?\.)\s*${escapedPropertyName}\b|(?:\?\.)?\[\s*${propertyExpression}\s*\])`;

  return [
    new RegExp(String.raw`${objectReference}\s*${propertyAccess}`),
    new RegExp(String.raw`\{[^}]*\b${escapedPropertyName}\b[^}]*\}\s*=\s*${objectReference}`),
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${propertyExpression}\s*;[\s\S]{0,1200}${objectReference}\s*(?:\?\.)?\[\s*\1\s*\]`,
    ),
  ];
}

function platformPropertyAccessPatterns(propertyName: string): RegExp[] {
  const escapedPropertyName = escapeRegExp(propertyName);
  const propertyExpression = stringLiteralExpressionPattern(propertyName);
  const platformObjectExpression = String.raw`\b(?:window|globalThis|self)\b`;
  const platformReference = String.raw`(?:\(?\s*${platformObjectExpression}(?:\s+as\s+[^)\]\n;]+)?\s*\)?)`;

  return [
    new RegExp(
      String.raw`${platformReference}\s*(?:(?:\.|\?\.)\s*${escapedPropertyName}\b|(?:\?\.)?\[\s*${propertyExpression}\s*\])`,
    ),
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${propertyExpression}\s*;[\s\S]{0,1200}${platformReference}\s*(?:\?\.)?\[\s*\1\s*\]`,
    ),
    new RegExp(String.raw`\{[^}]*\b${escapedPropertyName}\b[^}]*\}\s*=\s*${platformReference}`),
  ];
}

function passiveResourceElementCreationPatterns(elementNames: string[]): RegExp[] {
  const elementExpression = `(?:${elementNames.map(stringLiteralExpressionPattern).join('|')})`;
  const documentExpression = String.raw`(?:(?:\b(?:window|globalThis|self)\b\s*(?:\.|\?\.)\s*)?\bdocument\b|\b(?:window|globalThis|self)\b\s*(?:\?\.)?\[\s*${stringLiteralExpressionPattern(
    'document',
  )}\s*\])`;
  const createElementExpression = stringLiteralExpressionPattern('createElement');
  const createElementAccess = String.raw`(?:(?:\.|\?\.)\s*createElement\b|(?:\?\.)?\[\s*${createElementExpression}\s*\])`;
  const createElementCall = String.raw`${createElementAccess}\s*\(\s*`;

  return [
    new RegExp(String.raw`${documentExpression}\s*${createElementCall}${elementExpression}`),
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${elementExpression}\s*;[\s\S]{0,1200}${documentExpression}\s*${createElementCall}\1`,
    ),
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${createElementExpression}\s*;[\s\S]{0,1200}${documentExpression}\s*(?:\?\.)?\[\s*\1\s*\]\s*\(\s*${elementExpression}`,
    ),
    new RegExp(
      String.raw`\{[^}]*\bcreateElement\b[^}]*\}\s*=\s*${documentExpression}\s*;[\s\S]{0,1200}\bcreateElement\s*\(\s*${elementExpression}`,
    ),
    new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${documentExpression}\s*;[\s\S]{0,1200}\b\1\s*${createElementCall}${elementExpression}`,
    ),
  ];
}

function expectAnyPatternMatches(patterns: RegExp[], source: string, label: string) {
  expect(patterns.some((pattern) => pattern.test(source)), label).toBe(true);
}

function countPatternMatches(source: string, pattern: RegExp) {
  return Array.from(source.matchAll(pattern)).length;
}

function formatCodePoint(codePoint: number) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

function findStaticShellTextEncodingIssues(source: string) {
  const issues: string[] = [];
  for (let index = 0; index < source.length; ) {
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) {
      index += 1;
      continue;
    }
    const character = String.fromCodePoint(codePoint);
    if (
      character !== '\t' &&
      character !== '\n' &&
      character !== '\r' &&
      ((codePoint >= 0x00 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      issues.push(`control ${formatCodePoint(codePoint)}`);
    }
    if (/\p{Cf}/u.test(character)) {
      issues.push(`format ${formatCodePoint(codePoint)}`);
    }
    index += character.length;
  }
  for (const { label, pattern } of staticShellMojibakePatterns) {
    if (pattern.test(source)) {
      issues.push(`mojibake ${label}`);
    }
  }
  return issues;
}

function findStaticShellTextFormatIssues(source: string) {
  const issues: string[] = [];
  if (source.includes('\r')) {
    issues.push('carriage return');
  }
  if (!source.endsWith('\n')) {
    issues.push('missing terminal newline');
  }
  if (source.endsWith('\n\n')) {
    issues.push('extra terminal newline');
  }
  const lines = source.split('\n');
  const inspectedLines = source.endsWith('\n') ? lines.slice(0, -1) : lines;
  if (inspectedLines.some((line) => /[ \t]+$/.test(line))) {
    issues.push('trailing whitespace');
  }
  return issues;
}

function findStaticShellSourceByteBudgetIssues(sourcePath: string, source: string) {
  const byteBudget = staticShellSourceByteBudgets[sourcePath];
  if (byteBudget === undefined) {
    return [`missing budget for ${sourcePath}`];
  }
  const byteLength = Buffer.byteLength(source, 'utf-8');
  return byteLength > byteBudget ? [`${byteLength} bytes exceeds ${byteBudget} byte budget`] : [];
}

function cssLinePattern(line: string) {
  return new RegExp(String.raw`^\s*${escapeRegExp(line)}$`, 'gm');
}

function cssStateSelector(selector: string, state: string) {
  return selector
    .split(',')
    .map((selectorPart) => `${selectorPart.trim()}${state}`)
    .join(', ');
}

function collectManifestAppIntegrationKeys(value: unknown, disallowedKeys: Set<string>, matches: Set<string>) {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectManifestAppIntegrationKeys(item, disallowedKeys, matches);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (disallowedKeys.has(key)) {
      matches.add(key);
    }
    collectManifestAppIntegrationKeys(nestedValue, disallowedKeys, matches);
  }
}

function findManifestAppIntegrationKeys(manifestSource: string, disallowedKeys: string[]): string[] {
  const manifest = JSON.parse(manifestSource) as unknown;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [];
  }

  const keySet = new Set(disallowedKeys);
  const matches = new Set<string>();
  collectManifestAppIntegrationKeys(manifest, keySet, matches);
  return disallowedKeys.filter((key) => matches.has(key));
}

function findDuplicateJsonKeys(source: string): string[] {
  const duplicates: string[] = [];
  let index = 0;

  function skipWhitespace() {
    while (/\s/.test(source[index] ?? '')) {
      index += 1;
    }
  }

  function parseJsonString() {
    let value = '';
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '"') {
        index += 1;
        return value;
      }
      if (character === '\\') {
        const escaped = source[index + 1];
        if (escaped === 'u') {
          value += String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 6), 16));
          index += 6;
          continue;
        }
        value += escaped ?? '';
        index += 2;
        continue;
      }
      value += character;
      index += 1;
    }
    return value;
  }

  function parseJsonArray(path: string) {
    index += 1;
    skipWhitespace();
    let itemIndex = 0;
    while (index < source.length && source[index] !== ']') {
      parseJsonValue(`${path}[${itemIndex}]`);
      itemIndex += 1;
      skipWhitespace();
      if (source[index] === ',') {
        index += 1;
        skipWhitespace();
      }
    }
    if (source[index] === ']') {
      index += 1;
    }
  }

  function parseJsonObject(path: string) {
    const seenKeys = new Set<string>();
    index += 1;
    skipWhitespace();
    while (index < source.length && source[index] !== '}') {
      const key = parseJsonString();
      const keyPath = `${path}.${key}`;
      if (seenKeys.has(key)) {
        duplicates.push(keyPath);
      }
      seenKeys.add(key);
      skipWhitespace();
      if (source[index] === ':') {
        index += 1;
      }
      parseJsonValue(keyPath);
      skipWhitespace();
      if (source[index] === ',') {
        index += 1;
        skipWhitespace();
      }
    }
    if (source[index] === '}') {
      index += 1;
    }
  }

  function parseJsonValue(path: string) {
    skipWhitespace();
    if (source[index] === '{') {
      parseJsonObject(path);
      return;
    }
    if (source[index] === '[') {
      parseJsonArray(path);
      return;
    }
    if (source[index] === '"') {
      parseJsonString();
      return;
    }
    while (index < source.length && !/[\s,\]}]/.test(source[index])) {
      index += 1;
    }
  }

  parseJsonValue('$');
  return duplicates;
}

const productionShellSources: Record<string, string> = {
  '../index.html': readFileSync(join(webRootPath, 'index.html'), 'utf-8'),
  ...collectShellSources(join(webRootPath, 'public'), '../public'),
};
const nonServiceWorkerShellSources: Record<string, string> = Object.fromEntries(
  Object.entries(productionShellSources).filter(([sourcePath]) => sourcePath !== '../public/sw.js'),
);
const browserStorageAllowedAccessPatterns = new Map<string, readonly RegExp[]>([
  [
    './localization.ts',
    [
      /\bwindow\.localStorage\.setItem\(\s*LANGUAGE_STORAGE_KEY\s*,\s*choice\s*\)/,
      /\bwindow\.localStorage\.getItem\(\s*LANGUAGE_STORAGE_KEY\s*\)/,
    ],
  ],
]);
const browserNetworkAllowedAccessPatterns = new Map<string, readonly RegExp[]>([
  ['./main.tsx', [/\bloadAdminDashboard\(\s*window\.fetch\.bind\(\s*window\s*\),/]],
]);
const browserTimerAllowedCallPatterns = new Map<string, readonly RegExp[]>([
  [
    './adminData.ts',
    [
      /\bconst\s+timeoutId\s*=\s*setTimeout\(\s*\(\)\s*=>\s*controller\.abort\(\),\s*REQUEST_TIMEOUT_MS\s*\)/,
      /\bclearTimeout\(\s*timeoutId\s*\)/,
    ],
  ],
  [
    './sw-register.ts',
    [
      /\bsetInterval\(\s*\(\)\s*=>\s*\{\s*void\s+registration\.update\(\)\.catch\(ignoreServiceWorkerUpdateFailure\);\s*\},\s*60\s*\*\s*60\s*\*\s*1000\s*\)/,
    ],
  ],
]);
const serviceWorkerAllowedAccessPatterns = new Map<string, readonly RegExp[]>([
  [
    './sw-register.ts',
    [
      /\bif\s*\(\s*!\(\s*['"`]serviceWorker['"`]\s+in\s+targetNavigator\s*\)\s*\)/,
      /\bconst\s+serviceWorker\s*=\s*targetNavigator\.serviceWorker\b/,
      /\bserviceWorker\s*\.\s*register\(\s*['"`]\/sw\.js['"`]\s*\)/,
      /\bserviceWorker\s*\.\s*controller\b/,
      /\bserviceWorker\s*\.\s*addEventListener\(\s*['"`]controllerchange['"`]\s*,/,
    ],
  ],
]);

describe('web admin accessibility contracts', () => {
  it('keeps production Web Admin sources off source-level aria-label attributes', () => {
    const disallowedAttribute = ['aria', 'label'].join('-') + '=';
    const disallowedHtmlInjectionPatterns = [
      'dangerouslySetInnerHTML',
      '.innerHTML',
      '.outerHTML',
      'insertAdjacentHTML',
      'createContextualFragment',
      'document.write(',
      'srcDoc=',
    ];
    const disallowedScriptExecutionPatterns = [
      'eval(',
      'new Function',
    ];
    const allowedStaticShellEntrypointScript = '<script type="module" src="/src/main.tsx"></script>';
    const allowedStaticShellLinkTags = [
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
      '<link rel="manifest" href="/manifest.json" />',
    ];
    const allowedStaticShellRootMount = '<div id="root"></div>';
    const staticShellLinkTagPattern = /<link\b[^>]*>/gi;
    const staticShellRootIdAttributePattern = /\bid\s*=\s*["']root["']/i;
    const staticShellRootIdAttributeSearchPattern = /\bid\s*=\s*["']root["']/gi;
    const staticShellScriptOpenTagPattern = /<script\b[^>]*>/gi;
    const staticShellScriptCloseTagPattern = /<\/script>/gi;
    const staticShellStyleBlockOpenTagPattern = /<style\b[^>]*>/gi;
    const staticShellStyleBlockCloseTagPattern = /<\/style>/gi;
    const disallowedInlineEventHandlerPatterns = [/<[a-z][a-z0-9:-]*(?:\s+[^>]*?)?\son[a-z][\w:-]*\s*=/i];
    const disallowedInlineStyleAttributePatterns = [/<[a-z][a-z0-9:-]*(?:\s+[^>]*?)?\sstyle\s*=/i];
    const disallowedMetaRefreshPatterns = [
      /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:"\s*refresh\s*"|'\s*refresh\s*'|refresh\b))[^>]*>/i,
    ];
    const disallowedBaseElementPatterns = [/<base\b[^>]*>/i];
    const disallowedFocusAttributePatterns = [
      /<[a-z][a-z0-9:-]*(?:\s+[^>]*?)?\sautofocus(?:\s|=|>|\/)/i,
      /<[a-z][a-z0-9:-]*(?:\s+[^>]*?)?\stabindex\s*=/i,
    ];
    const disallowedInteractiveAttributePatterns = [
      /<[a-z][a-z0-9:-]*(?:\s+[^>]*?)?\scontenteditable(?:\s|=|>|\/)/i,
      /<[a-z][a-z0-9:-]*(?:\s+[^>]*?)?\sdraggable(?:\s|=|>|\/)/i,
      /<[a-z][a-z0-9:-]*(?:\s+[^>]*?)?\spopover(?:\s|=|>|\/)/i,
    ];
    const disallowedUrlProtocolPatterns = [
      'data:text/html',
      'javascript:',
      'vbscript:',
    ];
    const disallowedBrowserStoragePatterns = [
      /\bcaches\s*(?:\.|\?\.)\s*open\b/,
      /\bindexedDB\b/,
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      ...objectPropertyPatterns('document', 'cookie'),
      ...objectPropertyPatterns('navigator', 'storage'),
      ...objectPropertyPatterns('window', 'caches'),
      ...objectPropertyPatterns('window', 'indexedDB'),
      ...objectPropertyPatterns('window', 'localStorage'),
      ...objectPropertyPatterns('window', 'sessionStorage'),
    ];
    const disallowedNetworkPatterns = [
      /\b(?:BroadcastChannel|EventSource|SharedWorker|Worker|XMLHttpRequest|WebSocket)\b/,
      /\bfetch\s*(?:\.|\()/,
      /\bsendBeacon\b/,
      ...objectPropertyPatterns('navigator', 'sendBeacon'),
      ...objectPropertyPatterns('window', 'BroadcastChannel'),
      ...objectPropertyPatterns('window', 'EventSource'),
      ...objectPropertyPatterns('window', 'fetch'),
      ...objectPropertyPatterns('window', 'SharedWorker'),
      ...objectPropertyPatterns('window', 'WebSocket'),
      ...objectPropertyPatterns('window', 'Worker'),
      ...objectPropertyPatterns('window', 'XMLHttpRequest'),
    ];
    const disallowedRealtimeCommunicationPatterns = [
      /\bRTCDataChannel\b/,
      /\bRTCIceCandidate\b/,
      /\bRTCPeerConnection\b/,
      /\bRTCRtp(?:Receiver|Sender|Transceiver)\b/,
      /\bRTCSessionDescription\b/,
      /\bWebTransport(?:BidirectionalStream|DatagramDuplexStream)?\b/,
    ];
    const disallowedNavigationMutationPatterns = [
      /\brel\s*=\s*['"`]opener['"`]/,
      /\btarget\s*=\s*['"`]_blank['"`]/,
      ...objectPropertyPatterns('history', 'pushState'),
      ...objectPropertyPatterns('history', 'replaceState'),
      ...objectPropertyPatterns('location', 'assign'),
      ...objectPropertyPatterns('location', 'href'),
      ...objectPropertyPatterns('location', 'replace'),
      ...objectPropertyPatterns('window', 'open'),
    ];
    const disallowedCrossWindowMessagingPatterns = [
      /\bMessageChannel\b/,
      /\bMessagePort\b/,
      /\bpostMessage\b/,
      ...objectPropertyPatterns('document', 'domain'),
      ...objectPropertyPatterns('window', 'frames'),
      ...objectPropertyPatterns('window', 'MessageChannel'),
      ...objectPropertyPatterns('window', 'MessagePort'),
      ...objectPropertyPatterns('window', 'name'),
      ...objectPropertyPatterns('window', 'opener'),
      ...objectPropertyPatterns('window', 'parent'),
      ...objectPropertyPatterns('window', 'postMessage'),
      ...objectPropertyPatterns('window', 'top'),
    ];
    const disallowedFormSubmissionPatterns = [
      /<\s*form\b/,
      /<\s*form\b[\s\S]{0,400}\baction\s*=/,
      /<\s*form\b[\s\S]{0,400}\bmethod\s*=\s*['"`]\s*(?:get|post)\s*['"`]/i,
      /\bonSubmit\b/,
      new RegExp(String.raw`\baddEventListener\(\s*${stringLiteralExpressionPattern('submit')}`),
      ...methodCallPatterns('requestSubmit'),
      ...methodCallPatterns('submit'),
    ];
    const disallowedPassiveResourcePatterns = [
      /<\s*(?:audio|embed|iframe|img|object|picture|source|video)\b/i,
      /\b(?:poster|preload|srcset)\s*=/i,
      /\brel\s*=\s*['"`]\s*(?:prefetch|preload)\b/i,
      /\bnew\s+(?:window\.)?Image\s*\(/,
      ...objectPropertyPatterns('window', 'Image'),
      ...passiveResourceElementCreationPatterns(['audio', 'embed', 'iframe', 'img', 'object', 'picture', 'source', 'video']),
    ];
    const disallowedFileTransferPatterns = [
      /\bClipboardEvent\b/,
      /\bDataTransfer\b/,
      /\bFileReader\b/,
      /\bdownload=/,
      /\bdraggable=/,
      /\bonDrag\b/,
      /\bonDrop\b/,
      /\bshowOpenFilePicker\b/,
      ...objectPropertyPatterns('navigator', 'canShare'),
      ...objectPropertyPatterns('navigator', 'clipboard'),
      ...objectPropertyPatterns('navigator', 'share'),
      ...objectPropertyPatterns('URL', 'createObjectURL'),
      ...objectPropertyPatterns('window', 'showOpenFilePicker'),
    ];
    const disallowedPrivilegedBrowserApiPatterns = [
      /\bNotification\b/,
      /\bPaymentRequest\b/,
      /\brequestFullscreen\b/,
      /\bshowSaveFilePicker\b/,
      ...objectPropertyPatterns('document', 'exitFullscreen'),
      ...objectPropertyPatterns('navigator', 'bluetooth'),
      ...objectPropertyPatterns('navigator', 'geolocation'),
      ...objectPropertyPatterns('navigator', 'hid'),
      ...objectPropertyPatterns('navigator', 'mediaDevices'),
      ...objectPropertyPatterns('navigator', 'permissions'),
      ...objectPropertyPatterns('navigator', 'serial'),
      ...objectPropertyPatterns('navigator', 'usb'),
      ...objectPropertyPatterns('navigator', 'wakeLock'),
      ...objectPropertyPatterns('window', 'Notification'),
      ...objectPropertyPatterns('window', 'PaymentRequest'),
      ...objectPropertyPatterns('window', 'showSaveFilePicker'),
    ];
    const disallowedContactPickerPatterns = [
      /\bContactsManager\b/,
      ...objectPropertyPatterns('navigator', 'contacts'),
    ];
    const disallowedProtocolHandlerPatterns = [
      ...objectPropertyPatterns('navigator', 'registerProtocolHandler'),
      ...objectPropertyPatterns('navigator', 'unregisterProtocolHandler'),
    ];
    const disallowedBrowserAppIntegrationPatterns = [
      /\bIdleDetector\b/,
      /\bPresentationRequest\b/,
      /\blaunchQueue\b/,
      ...objectPropertyPatterns('navigator', 'clearAppBadge'),
      ...objectPropertyPatterns('navigator', 'setAppBadge'),
      ...objectPropertyPatterns('navigator', 'getInstalledRelatedApps'),
      ...objectPropertyPatterns('navigator', 'locks'),
      ...objectPropertyPatterns('navigator', 'presentation'),
      ...objectPropertyPatterns('navigator', 'windowControlsOverlay'),
      ...objectPropertyPatterns('window', 'launchQueue'),
      ...objectPropertyPatterns('window', 'showDirectoryPicker'),
      /\bshowDirectoryPicker\b/,
    ];
    const disallowedManifestAppIntegrationKeys = [
      'display_override',
      'file_handlers',
      'handle_links',
      'launch_handler',
      'prefer_related_applications',
      'protocol_handlers',
      'related_applications',
      'scope_extensions',
      'share_target',
      'url_handlers',
    ];
    const disallowedServiceWorkerPatterns = [
      /['"`]serviceWorker['"`]\s+in\b/,
      /\bnavigator\s*(?:\.|\?\.)\s*serviceWorker\b/,
      /\bServiceWorker(?:Container|Registration)?\b/,
      /\bserviceWorker\s*(?:\.|\?\.)\s*(?:getRegistration|getRegistrations|ready|register)\b/,
      ...objectPropertyPatterns('navigator', 'serviceWorker'),
    ];
    const deviceSensorConstructorNames =
      '(?:Accelerometer|AmbientLightSensor|DeviceMotionEvent|DeviceOrientationEvent|GamepadEvent|Gyroscope|LinearAccelerationSensor|Magnetometer|(?:Absolute|Relative)?OrientationSensor|XR(?:Frame|Session|System|WebGLLayer))';
    const deviceSensorComputedKeyHint = '(?:Accelerometer|Sensor|Device|Gamepad|Gyroscope|Magnetometer|Orientation|XR)';
    const navigatorSensorAccessNames = '(?:getGamepads|vibrate|xr)';
    const navigatorSensorComputedKeyHint = '(?:Gamepads|vibrate|xr|Game|pads)';
    const platformLikeObjectExpression = String.raw`\b(?:window|globalThis|self)\b`;
    const platformLikeReference = String.raw`(?:\(?\s*${platformLikeObjectExpression}(?:\s+as\s+[^)\]\n;]+)?\s*\)?)`;
    const navigatorReference = String.raw`(?:\(?\s*(?:(?:${platformLikeObjectExpression}\s*(?:\.|\?\.)\s*)?\bnavigator\b|${platformLikeObjectExpression}\s*(?:\?\.)?\[\s*${stringLiteralExpressionPattern(
      'navigator',
    )}\s*\])(?:\s+as\s+[^)\]\n;]+)?\s*\)?)`;
    const screenReference = String.raw`(?:\(?\s*(?:(?:${platformLikeObjectExpression}\s*(?:\.|\?\.)\s*)?\bscreen\b|${platformLikeObjectExpression}\s*(?:\?\.)?\[\s*${stringLiteralExpressionPattern(
      'screen',
    )}\s*\])(?:\s+as\s+[^)\]\n;]+)?\s*\)?)`;
    const orientationAccess = String.raw`(?:(?:\.|\?\.)\s*orientation\b|(?:\?\.)?\[\s*${stringLiteralExpressionPattern(
      'orientation',
    )}\s*\])`;
    const orientationLockAccess = String.raw`(?:(?:\.|\?\.)\s*lock\b|(?:\?\.)?\[\s*${stringLiteralExpressionPattern(
      'lock',
    )}\s*\])`;
    const disallowedDeviceSensorPatterns = [
      /\bAccelerometer\b/,
      /\bAmbientLightSensor\b/,
      /\bDeviceMotionEvent\b/,
      /\bDeviceOrientationEvent\b/,
      /\bGamepadEvent\b/,
      /\bGyroscope\b/,
      /\bLinearAccelerationSensor\b/,
      /\bMagnetometer\b/,
      /\b(?:Absolute|Relative)?OrientationSensor\b/,
      /\bnavigator\s*(?:\.|\?\.)\s*getGamepads\b/,
      /\bnavigator\s*(?:\.|\?\.)\s*vibrate\b/,
      /\bnavigator\s*(?:\.|\?\.)\s*xr\b/,
      /\bscreen\s*(?:\.|\?\.)\s*orientation\s*(?:\.|\?\.)\s*lock\b/,
      /\bXR(?:Frame|Session|System|WebGLLayer)\b/,
      new RegExp(
        String.raw`${platformLikeReference}\s*(?:(?:\.|\?\.)\s*${deviceSensorConstructorNames}\b|(?:\?\.)?\[\s*[^\]\n;]*${deviceSensorComputedKeyHint}[^\]\n;]*\])`,
      ),
      new RegExp(String.raw`\{[^}]*\b${deviceSensorConstructorNames}\b[^}]*\}\s*=\s*${platformLikeReference}`),
      new RegExp(
        String.raw`${navigatorReference}\s*(?:(?:\.|\?\.)\s*${navigatorSensorAccessNames}\b|(?:\?\.)?\[\s*[^\]\n;]*${navigatorSensorComputedKeyHint}[^\]\n;]*\])`,
      ),
      new RegExp(
        String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*${navigatorSensorComputedKeyHint}[^;\n]*;[\s\S]{0,1200}${navigatorReference}\s*(?:\?\.)?\[\s*\1\s*\]`,
      ),
      new RegExp(String.raw`\{[^}]*\b${navigatorSensorAccessNames}\b[^}]*\}\s*=\s*${navigatorReference}`),
      new RegExp(String.raw`${screenReference}\s*${orientationAccess}\s*${orientationLockAccess}\s*\(`),
      new RegExp(
        String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${stringLiteralExpressionPattern(
          'lock',
        )}\s*;[\s\S]{0,1200}${screenReference}\s*${orientationAccess}\s*(?:\?\.)?\[\s*\1\s*\]\s*\(`,
      ),
    ];
    const disallowedBrowserFingerprintingPatterns = [
      ...objectPropertyPatterns('navigator', 'connection'),
      ...objectPropertyPatterns('navigator', 'deviceMemory'),
      ...objectPropertyPatterns('navigator', 'doNotTrack'),
      ...objectPropertyPatterns('navigator', 'getBattery'),
      ...objectPropertyPatterns('navigator', 'hardwareConcurrency'),
      ...objectPropertyPatterns('navigator', 'keyboard'),
      ...objectPropertyPatterns('navigator', 'language'),
      ...objectPropertyPatterns('navigator', 'languages'),
      ...objectPropertyPatterns('navigator', 'maxTouchPoints'),
      ...objectPropertyPatterns('navigator', 'mediaCapabilities'),
      ...objectPropertyPatterns('navigator', 'platform'),
      ...objectPropertyPatterns('navigator', 'userAgent'),
      ...objectPropertyPatterns('navigator', 'userAgentData'),
      ...objectPropertyPatterns('navigator', 'vendor'),
      ...objectPropertyPatterns('performance', 'memory'),
      ...objectPropertyPatterns('screen', 'colorDepth'),
      ...objectPropertyPatterns('screen', 'pixelDepth'),
      ...objectPropertyPatterns('window', 'visualViewport'),
      /\bvisualViewport\b/,
    ];
    const disallowedMediaCanvasCapturePatterns = [
      /\bAudioContext\b/,
      /\bBarcodeDetector\b/,
      /\bCanvasRenderingContext2D\b/,
      /\bEyeDropper\b/,
      /\bFaceDetector\b/,
      /\bHTMLCanvasElement\b/,
      /\bImageCapture\b/,
      /\bMediaRecorder\b/,
      /\bMediaStream(?:Track)?\b/,
      /\bMIDIAccess\b/,
      /\bMIDIPort\b/,
      /\bNDEFReader\b/,
      /\bOffscreenCanvas\b/,
      /\bTextDetector\b/,
      /\bcaptureStream\s*\(/,
      /\bgetDisplayMedia\s*\(/,
      /\bgetUserMedia\s*\(/,
      /\bnavigator\s*(?:\.|\?\.)\s*requestMIDIAccess\b/,
      /\btoBlob\s*\(/,
      /\btoDataURL\s*\(/,
      /\bwebkitAudioContext\b/,
      ...methodCallPatterns('captureStream'),
      ...methodCallPatterns('getDisplayMedia'),
      ...methodCallPatterns('getUserMedia'),
      ...methodCallPatterns('requestMIDIAccess'),
      ...methodCallPatterns('toBlob'),
      ...methodCallPatterns('toDataURL'),
      ...objectPropertyPatterns('navigator', 'requestMIDIAccess'),
      ...objectPropertyPatterns('window', 'AudioContext'),
      ...objectPropertyPatterns('window', 'BarcodeDetector'),
      ...objectPropertyPatterns('window', 'EyeDropper'),
      ...objectPropertyPatterns('window', 'FaceDetector'),
      ...objectPropertyPatterns('window', 'ImageCapture'),
      ...objectPropertyPatterns('window', 'MediaRecorder'),
      ...objectPropertyPatterns('window', 'NDEFReader'),
      ...objectPropertyPatterns('window', 'OffscreenCanvas'),
      ...objectPropertyPatterns('window', 'TextDetector'),
      ...objectPropertyPatterns('window', 'webkitAudioContext'),
    ];
    const disallowedDomExpansionPatterns = [
      /\bDOMParser\b/,
      /\bPasswordCredential\b/,
      /\bPublicKeyCredential\b/,
      /\bXMLSerializer\b/,
      /\bpopover\s*=/i,
      ...methodCallPatterns('attachShadow'),
      ...methodCallPatterns('createRange'),
      ...methodCallPatterns('execCommand'),
      ...methodCallPatterns('parseFromString'),
      ...objectPropertyPatterns('navigator', 'credentials'),
      ...platformPropertyAccessPatterns('customElements'),
      ...platformPropertyAccessPatterns('DOMParser'),
      ...platformPropertyAccessPatterns('PasswordCredential'),
      ...platformPropertyAccessPatterns('PublicKeyCredential'),
      ...platformPropertyAccessPatterns('XMLSerializer'),
      ...propertyAccessPatterns('contentEditable'),
      ...propertyAccessPatterns('shadowRoot'),
    ];
    const disallowedNativeDialogPatterns = [
      /\balert\s*\(/,
      /\bbeforeunload\b/,
      /\bconfirm\s*\(/,
      /\bonbeforeunload\b/,
      /\bprint\s*\(/,
      /\bprompt\s*\(/,
      new RegExp(String.raw`\baddEventListener\(\s*${stringLiteralExpressionPattern('beforeunload')}`),
      ...platformPropertyAccessPatterns('alert'),
      ...platformPropertyAccessPatterns('confirm'),
      ...platformPropertyAccessPatterns('onbeforeunload'),
      ...platformPropertyAccessPatterns('print'),
      ...platformPropertyAccessPatterns('prompt'),
      ...propertyAccessPatterns('alert'),
      ...propertyAccessPatterns('confirm'),
      ...propertyAccessPatterns('print'),
      ...propertyAccessPatterns('prompt'),
    ];
    const observerAndSchedulerPropertyNames =
      '(?:cancelAnimationFrame|cancelIdleCallback|IntersectionObserver|MutationObserver|PerformanceObserver|queueMicrotask|requestAnimationFrame|requestIdleCallback|ResizeObserver|scheduler)';
    const observerAndSchedulerComputedKeyHint =
      '(?:AnimationFrame|IdleCallback|Observer|queueMicrotask|scheduler)';
    const platformObjectExpression = String.raw`\b(?:window|globalThis|self)\b`;
    const platformReference = String.raw`(?:\(?\s*${platformObjectExpression}(?:\s+as\s+[^)\]\n;]+)?\s*\)?)`;
    const schedulerTaskMethodHint = '(?:postTask|yield|post|Task)';
    const disallowedObserverAndFrameSchedulerPatterns = [
      /\bcancelAnimationFrame\b/,
      /\bcancelIdleCallback\b/,
      /\bIntersectionObserver\b/,
      /\bMutationObserver\b/,
      /\bPerformanceObserver\b/,
      /\bqueueMicrotask\b/,
      /\brequestAnimationFrame\b/,
      /\brequestIdleCallback\b/,
      /\bResizeObserver\b/,
      /\bscheduler\s*(?:\.|\?\.)\s*postTask\b/,
      /\bscheduler\s*(?:\.|\?\.)\s*yield\b/,
      new RegExp(String.raw`\bscheduler\s*(?:\?\.)?\[\s*[^\]\n;]*${schedulerTaskMethodHint}[^\]\n;]*\]`),
      new RegExp(
        String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*${schedulerTaskMethodHint}[^;\n]*;[\s\S]{0,1200}\bscheduler\s*(?:\?\.)?\[\s*\1\s*\]`,
      ),
      /\{[^}]*\b(?:postTask|yield)\b[^}]*\}\s*=\s*scheduler\b/,
      new RegExp(
        String.raw`${platformReference}\s*(?:(?:\.|\?\.)\s*${observerAndSchedulerPropertyNames}\b|(?:\?\.)?\[\s*[^\]\n;]*${observerAndSchedulerComputedKeyHint}[^\]\n;]*\])`,
      ),
      new RegExp(
        String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*${observerAndSchedulerComputedKeyHint}[^;\n]*;[\s\S]{0,1200}${platformReference}\s*(?:\?\.)?\[\s*\1\s*\]`,
      ),
      new RegExp(String.raw`\{[^}]*\b${observerAndSchedulerPropertyNames}\b[^}]*\}\s*=\s*${platformReference}`),
    ];
    const browserTimerCallPattern = /\b(?:set|clear)(?:Interval|Timeout)\s*\(/g;
    const browserStorageAccessPattern =
      /\bcaches\.open\b|\bdocument\.cookie\b|\bindexedDB\b|\b(?:window\.)?localStorage\s*\.\s*(?:getItem|setItem|removeItem|clear|key)\b|\bnavigator\.storage\b|\bsessionStorage\b/g;
    const browserNetworkAccessPattern =
      /\b(?:BroadcastChannel|EventSource|SharedWorker|Worker|XMLHttpRequest|WebSocket)\b|\b(?:window\.)?fetch\s*(?:\.|\()|\bnavigator\s*\.\s*sendBeacon\b|\bsendBeacon\b/g;
    const disallowedBrowserTimerPattern = /\b(?:set|clear)(?:Interval|Timeout)\s*\(/;
    const serviceWorkerApiAccessPattern =
      /(?:['"`]serviceWorker['"`]\s+in\s+\w+|\b\w+\.serviceWorker\b|\bserviceWorker\s*\.\s*[A-Za-z_$][\w$]*\b)/g;
    const disallowedStringTimerPattern = /set(?:Interval|Timeout)\(\s*['"`]/;

    expect(Object.keys(productionSources)).toContain('./main.tsx');
    expect(Object.keys(productionSources)).toContain('./localization.ts');
    expect(Object.keys(productionSources)).toContain('./sw-register.ts');
    expect(Object.keys(productionShellSources).sort(), 'static shell source inventory').toEqual(
      staticShellExpectedSourcePaths,
    );
    expect(Object.keys(nonServiceWorkerShellSources).sort(), 'non-Service Worker static shell source inventory').toEqual(
      staticNonServiceWorkerShellExpectedSourcePaths,
    );
    expect(Object.keys(staticShellSourceByteBudgets).sort(), 'static shell byte budget inventory').toEqual(
      staticShellExpectedSourcePaths,
    );
    for (const [sourcePath, source] of Object.entries(productionShellSources)) {
      expect(findStaticShellTextEncodingIssues(source), `${sourcePath} static shell text encoding hygiene`).toEqual([]);
      expect(findStaticShellTextFormatIssues(source), `${sourcePath} static shell text format hygiene`).toEqual([]);
      expect(findStaticShellSourceByteBudgetIssues(sourcePath, source), `${sourcePath} static shell byte budget`).toEqual(
        [],
      );
      if (sourcePath.endsWith('.json')) {
        expect(findDuplicateJsonKeys(source), `${sourcePath} static JSON duplicate-key hygiene`).toEqual([]);
      }
    }
    const staticManifest = JSON.parse(productionShellSources['../public/manifest.json']);
    for (const {
      actionHref,
      actionLinkSource,
      actionSelector,
      actionText,
      descriptionText,
      headingText,
      iconText,
      sourcePath: fallbackSourcePath,
      statusText,
      titleText,
    } of staticFallbackShellContracts) {
      const fallbackSource = productionShellSources[fallbackSourcePath];
      expect(fallbackSource, `${fallbackSourcePath} fallback shell coverage`).toBeDefined();
      for (const { label, pattern } of staticFallbackDocumentShellPatterns) {
        expect(
          countPatternMatches(fallbackSource, pattern),
          `${fallbackSourcePath} fallback document shell ${label}`,
        ).toBe(1);
      }
      for (const { label, pattern } of staticFallbackSecurityMetaPatterns) {
        expect(
          countPatternMatches(fallbackSource, pattern),
          `${fallbackSourcePath} fallback security ${label}`,
        ).toBe(1);
      }
      expect(
        countPatternMatches(fallbackSource, new RegExp(String.raw`<title>${escapeRegExp(titleText)}</title>`, 'g')),
        `${fallbackSourcePath} fallback document title`,
      ).toBe(1);
      expect(countPatternMatches(fallbackSource, /<main(?:\s|>)/g), `${fallbackSourcePath} fallback native main landmark`).toBe(1);
      expect(countPatternMatches(fallbackSource, /<\/main>/g), `${fallbackSourcePath} fallback native main landmark`).toBe(1);
      expect(fallbackSource, `${fallbackSourcePath} fallback source-level role guard`).not.toMatch(/\srole\s*=/);
      expect(fallbackSource, `${fallbackSourcePath} fallback unused button guard`).not.toMatch(/\bbutton\b/);
      expect(
        countPatternMatches(
          fallbackSource,
          new RegExp(String.raw`<div\s+class="icon"\s+aria-hidden="true">${escapeRegExp(iconText)}</div>`, 'g'),
        ),
        `${fallbackSourcePath} fallback decorative icon`,
      ).toBe(1);
      expect(fallbackSource, `${fallbackSourcePath} fallback focus-visible style`).toContain(':focus-visible');
      expect(fallbackSource, `${fallbackSourcePath} fallback focus outline style`).toContain('outline: 2px solid #58a6ff;');
      expect(fallbackSource, `${fallbackSourcePath} fallback focus outline offset style`).toContain('outline-offset: 2px;');
      expect(fallbackSource, `${fallbackSourcePath} fallback reduced-motion style`).toContain('@media (prefers-reduced-motion: reduce)');
      expect(fallbackSource, `${fallbackSourcePath} fallback reduced-motion transition guard`).toContain('transition: none;');
      expect(fallbackSource, `${fallbackSourcePath} fallback forced-colors style`).toContain('@media (forced-colors: active)');
      expect(fallbackSource, `${fallbackSourcePath} fallback forced-colors action border`).toContain('border: 1px solid ButtonText;');
      expect(countPatternMatches(fallbackSource, /<style>/g), `${fallbackSourcePath} fallback style block open`).toBe(
        1,
      );
      expect(countPatternMatches(fallbackSource, /<\/style>/g), `${fallbackSourcePath} fallback style block close`).toBe(
        1,
      );
      expect(
        countPatternMatches(fallbackSource, cssLinePattern(`${actionSelector} {`)),
        `${fallbackSourcePath} fallback base action selector`,
      ).toBe(1);
      expect(
        countPatternMatches(fallbackSource, cssLinePattern(`${cssStateSelector(actionSelector, ':hover')} { background: #2ea043; }`)),
        `${fallbackSourcePath} fallback hover action selector`,
      ).toBe(1);
      expect(
        countPatternMatches(fallbackSource, cssLinePattern(`${cssStateSelector(actionSelector, ':focus-visible')} {`)),
        `${fallbackSourcePath} fallback focus action selector`,
      ).toBe(1);
      expect(
        countPatternMatches(fallbackSource, cssLinePattern(`${actionSelector} { transition: none; }`)),
        `${fallbackSourcePath} fallback reduced-motion action selector`,
      ).toBe(1);
      expect(
        countPatternMatches(fallbackSource, cssLinePattern(`${actionSelector} { border: 1px solid ButtonText; }`)),
        `${fallbackSourcePath} fallback forced-colors action selector`,
      ).toBe(1);
      for (const styleNeedle of staticFallbackActionStyleNeedles) {
        expect(fallbackSource, `${fallbackSourcePath} fallback primary action style`).toContain(styleNeedle);
      }
      for (const styleNeedle of staticFallbackPageFrameStyleNeedles) {
        expect(fallbackSource, `${fallbackSourcePath} fallback page frame style`).toContain(styleNeedle);
      }
      for (const styleNeedle of staticFallbackIconStyleNeedles) {
        expect(fallbackSource, `${fallbackSourcePath} fallback icon style`).toContain(styleNeedle);
      }
      expect(
        countPatternMatches(fallbackSource, new RegExp(String.raw`<h1>${escapeRegExp(headingText)}</h1>`, 'g')),
        `${fallbackSourcePath} fallback visible heading`,
      ).toBe(1);
      expect(
        countPatternMatches(fallbackSource, new RegExp(String.raw`<p>${escapeRegExp(descriptionText)}</p>`, 'g')),
        `${fallbackSourcePath} fallback visible description`,
      ).toBe(1);
      if (statusText === undefined) {
        expect(fallbackSource, `${fallbackSourcePath} fallback status-code guard`).not.toContain('class="status-code"');
      } else {
        expect(
          countPatternMatches(
            fallbackSource,
            new RegExp(String.raw`<p\s+class="status-code">${escapeRegExp(statusText)}</p>`, 'g'),
          ),
          `${fallbackSourcePath} fallback status code`,
        ).toBe(1);
        for (const styleNeedle of staticFallbackStatusCodeStyleNeedles) {
          expect(fallbackSource, `${fallbackSourcePath} fallback status-code style`).toContain(styleNeedle);
        }
      }
      expect(
        countPatternMatches(
          fallbackSource,
          new RegExp(String.raw`<a\b(?=[^>]*\shref="${escapeRegExp(actionHref)}")[^>]*>${escapeRegExp(actionText)}</a>`, 'g'),
        ),
        `${fallbackSourcePath} fallback visible action link`,
      ).toBe(1);
      expect(
        countPatternMatches(fallbackSource, new RegExp(escapeRegExp(actionLinkSource), 'g')),
        `${fallbackSourcePath} fallback exact action source`,
      ).toBe(1);
    }

    expectAnyPatternMatches(
      disallowedContactPickerPatterns,
      "const contactKey = 'con' + 'tacts'; navigator?.[contactKey]?.select?.(['name']);",
      'contact picker computed key guard',
    );
    expectAnyPatternMatches(
      disallowedContactPickerPatterns,
      "navigator['con' + 'tacts']?.select?.(['email']);",
      'contact picker inline computed key guard',
    );
    expectAnyPatternMatches(
      disallowedProtocolHandlerPatterns,
      "const registerKey = 'register' + 'ProtocolHandler'; window.navigator[registerKey]('web+demo', '/?u=%s');",
      'protocol handler computed key guard',
    );
    expectAnyPatternMatches(
      disallowedProtocolHandlerPatterns,
      "const { navigator: nav } = window; nav[`register${'Protocol'}Handler`]('web+demo', '/?u=%s');",
      'protocol handler destructured alias computed key guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserAppIntegrationPatterns,
      "const badgeKey = 'set' + 'AppBadge'; const platformNavigator = navigator; platformNavigator?.[badgeKey]?.(1);",
      'browser app integration computed key guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserAppIntegrationPatterns,
      "const platformNavigator = window['navigator']; platformNavigator['set' + 'AppBadge'](1);",
      'browser app integration bracket object alias guard',
    );
    expectAnyPatternMatches(
      disallowedServiceWorkerPatterns,
      "const serviceWorkerKey = 'service' + 'Worker'; window.navigator[serviceWorkerKey]?.register?.('/sw.js');",
      'service worker computed key guard',
    );
    expectAnyPatternMatches(
      disallowedServiceWorkerPatterns,
      "const { navigator: platformNavigator } = window; platformNavigator[`service${'Worker'}`]?.ready;",
      'service worker destructured alias computed key guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserStoragePatterns,
      "const storageKey = 'local' + 'Storage'; window[storageKey]?.getItem('x');",
      'browser storage computed key guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserStoragePatterns,
      "const { localStorage: storage } = window; storage.setItem('x', 'y');",
      'browser storage destructured alias guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserStoragePatterns,
      "const storageManagerKey = 'storage'; window.navigator[storageManagerKey]?.persist?.();",
      'storage manager computed key guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserStoragePatterns,
      "const cacheApi = globalThis['caches']; cacheApi.open('x');",
      'cache API object alias guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserStoragePatterns,
      "(document as Document)['cook' + 'ie'] = 'x=y';",
      'document cookie type-cast computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNetworkPatterns,
      "const fetchKey = 'fe' + 'tch'; globalThis[fetchKey]?.('/api/admin/snapshot');",
      'browser network fetch computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNetworkPatterns,
      "const { fetch: request } = window; request('/api/admin/snapshot');",
      'browser network fetch destructured alias guard',
    );
    expectAnyPatternMatches(
      disallowedNetworkPatterns,
      "const beaconKey = 'send' + 'Beacon'; window.navigator[beaconKey]?.('/audit', 'x');",
      'browser network beacon computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNetworkPatterns,
      "const socketConstructor = window['Web' + 'Socket']; new socketConstructor('wss://example.invalid');",
      'browser network websocket computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNetworkPatterns,
      "const xhrConstructor = (window as Window)['XML' + 'HttpRequest']; new xhrConstructor();",
      'browser network xhr type-cast computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNavigationMutationPatterns,
      "const pushKey = 'push' + 'State'; window.history[pushKey]({}, '', '#storage');",
      'navigation mutation history computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNavigationMutationPatterns,
      "const { location: targetLocation } = window; targetLocation['re' + 'place']('/logout');",
      'navigation mutation location destructured alias guard',
    );
    expectAnyPatternMatches(
      disallowedNavigationMutationPatterns,
      "const hrefKey = 'hr' + 'ef'; window.location[hrefKey] = '/external';",
      'navigation mutation href computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNavigationMutationPatterns,
      "const openKey = 'op' + 'en'; globalThis[openKey]?.('/docs', '_blank');",
      'navigation mutation window open computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNavigationMutationPatterns,
      "(window.history as History)['replace' + 'State']({}, '', '#sync');",
      'navigation mutation history type-cast computed key guard',
    );
    expectAnyPatternMatches(
      disallowedCrossWindowMessagingPatterns,
      "const messageKey = 'post' + 'Message'; window[messageKey]?.({ type: 'x' }, '*');",
      'cross-window messaging postMessage computed key guard',
    );
    expectAnyPatternMatches(
      disallowedCrossWindowMessagingPatterns,
      "const { parent: hostWindow } = window; hostWindow.postMessage({ type: 'x' }, '*');",
      'cross-window messaging parent destructured alias guard',
    );
    expectAnyPatternMatches(
      disallowedCrossWindowMessagingPatterns,
      "const channelConstructor = globalThis['Message' + 'Channel']; new channelConstructor();",
      'cross-window messaging channel computed key guard',
    );
    expectAnyPatternMatches(
      disallowedCrossWindowMessagingPatterns,
      "(document as Document)['do' + 'main'] = 'example.invalid';",
      'cross-window messaging document domain type-cast computed key guard',
    );
    expectAnyPatternMatches(
      disallowedCrossWindowMessagingPatterns,
      "const openerKey = 'op' + 'ener'; window[openerKey]?.postMessage('x', '*');",
      'cross-window messaging opener computed key guard',
    );
    expectAnyPatternMatches(
      disallowedInlineEventHandlerPatterns,
      '<a href="/" onclick="return false">Retry</a>',
      'inline event handler click attribute guard',
    );
    expectAnyPatternMatches(
      disallowedInlineEventHandlerPatterns,
      '<svg onload="alert(1)"></svg>',
      'inline event handler load attribute guard',
    );
    expectAnyPatternMatches(
      disallowedInlineStyleAttributePatterns,
      '<div style="color: red">Status</div>',
      'inline style attribute element guard',
    );
    expectAnyPatternMatches(
      disallowedInlineStyleAttributePatterns,
      '<svg viewBox="0 0 1 1" style = "display: none"></svg>',
      'inline style attribute svg guard',
    );
    expectAnyPatternMatches(
      disallowedMetaRefreshPatterns,
      '<meta http-equiv="refresh" content="0; url=/logout" />',
      'meta refresh redirect guard',
    );
    expectAnyPatternMatches(
      disallowedMetaRefreshPatterns,
      '<meta content="5" http-equiv = refresh>',
      'meta refresh attribute-order guard',
    );
    expectAnyPatternMatches(
      disallowedBaseElementPatterns,
      '<base href="/admin/" />',
      'base element href guard',
    );
    expectAnyPatternMatches(
      disallowedBaseElementPatterns,
      '<base target="_blank">',
      'base element target guard',
    );
    expectAnyPatternMatches(
      disallowedFocusAttributePatterns,
      '<a href="/" autofocus>Retry</a>',
      'autofocus attribute guard',
    );
    expectAnyPatternMatches(
      disallowedFocusAttributePatterns,
      '<main tabindex="-1">Fallback</main>',
      'tabindex attribute guard',
    );
    expectAnyPatternMatches(
      disallowedInteractiveAttributePatterns,
      '<main contenteditable="true">Fallback</main>',
      'contenteditable attribute guard',
    );
    expectAnyPatternMatches(
      disallowedInteractiveAttributePatterns,
      '<a href="/" draggable = "true">Retry</a>',
      'draggable attribute guard',
    );
    expectAnyPatternMatches(
      disallowedInteractiveAttributePatterns,
      '<div popover>Recovery details</div>',
      'popover attribute guard',
    );
    expectAnyPatternMatches(
      [/<link\b[^>]*>/i],
      '<link rel="stylesheet" href="/fallback.css" />',
      'static shell link tag stylesheet fixture',
    );
    expectAnyPatternMatches(
      [/<link\b[^>]*>/i],
      '<link href="/alternate.svg" rel="alternate icon">',
      'static shell link tag alternate icon fixture',
    );
    expectAnyPatternMatches(
      [staticShellRootIdAttributePattern],
      '<main id="root">Fallback</main>',
      'static shell root id fixture',
    );
    expectAnyPatternMatches(
      [staticShellRootIdAttributePattern],
      '<div id = "root"></div>',
      'static shell spaced root id fixture',
    );
    expectAnyPatternMatches(
      [/<style\b[^>]*>/i],
      '<style media="screen">body { color: red; }</style>',
      'static shell style block open fixture',
    );
    expectAnyPatternMatches(
      [/<\/style>/i],
      '<style>body { color: red; }</style>',
      'static shell style block close fixture',
    );
    expect(findStaticShellTextEncodingIssues('hidden\u0000control')).toContain('control U+0000');
    expect(findStaticShellTextEncodingIssues('hidden\u009Fcontrol')).toContain('control U+009F');
    expect(findStaticShellTextEncodingIssues('hidden\u202Econtrol')).toContain('format U+202E');
    expect(findStaticShellTextEncodingIssues('JoeSSH 鈥? Offline')).toContain(
      'mojibake UTF-8 punctuation mojibake',
    );
    expect(findStaticShellTextEncodingIssues('Icon 馃摗')).toContain('mojibake emoji mojibake');
    expect(findStaticShellTextFormatIssues('line\r\n')).toContain('carriage return');
    expect(findStaticShellTextFormatIssues('line')).toContain('missing terminal newline');
    expect(findStaticShellTextFormatIssues('line\n\n')).toContain('extra terminal newline');
    expect(findStaticShellTextFormatIssues('line \n')).toContain('trailing whitespace');
    const oversizedRobotsSource = 'x'.repeat(staticShellSourceByteBudgets['../public/robots.txt'] + 1);
    expect(
      findStaticShellSourceByteBudgetIssues('../public/robots.txt', oversizedRobotsSource),
    ).toContain('129 bytes exceeds 128 byte budget');
    expect(findDuplicateJsonKeys('{"id":"/","id":"/admin"}')).toContain('$.id');
    expect(findDuplicateJsonKeys('{"shortcuts":[{"name":"Team","name":"Shadow"}]}')).toContain(
      '$.shortcuts[0].name',
    );
    expect(staticManifest, 'static manifest install metadata baseline').toEqual({
      id: '/',
      name: 'JoeSSH Admin',
      short_name: 'JoeSSH',
      description: 'Team management, device status, audit logs, and sync operations.',
      start_url: '/',
      display: 'standalone',
      background_color: '#101820',
      theme_color: '#101820',
      orientation: 'any',
      scope: '/',
      shortcuts: staticManifestExpectedShortcuts.map((shortcut) => ({
        ...shortcut,
        icons: [{ src: '/favicon.svg', sizes: 'any' }],
      })),
      categories: ['productivity', 'utilities'],
      icons: [
        {
          src: '/favicon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        },
      ],
    });
    expect(
      productionShellSources['../public/favicon.svg'].replace(/\r\n/g, '\n').trim(),
      '../public/favicon.svg static favicon SVG baseline',
    ).toBe(staticFaviconExpectedSource);
    expect(
      productionShellSources['../public/_headers'].replace(/\r\n/g, '\n').trim(),
      '../public/_headers static deployment header baseline',
    ).toBe(staticDeploymentHeadersExpectedSource);
    expect(
      productionShellSources['../public/robots.txt'].replace(/\r\n/g, '\n').trim(),
      '../public/robots.txt static text asset baseline',
    ).toBe(staticRobotsTxtExpectedSource);
    expect(
      productionShellSources['../public/humans.txt'].replace(/\r\n/g, '\n').trim(),
      '../public/humans.txt static text asset baseline',
    ).toBe(staticHumansTxtExpectedSource);
    expect(
      productionShellSources['../public/.well-known/security.txt'].replace(/\r\n/g, '\n').trim(),
      '../public/.well-known/security.txt static security contact baseline',
    ).toBe(staticSecurityTxtExpectedSource);
    const staticServiceWorkerSource = productionShellSources['../public/sw.js'].replace(/\r\n/g, '\n');
    expect(
      Array.from(staticServiceWorkerSource.matchAll(/self\.addEventListener\('([^']+)'/g), ([, eventType]) => eventType),
      '../public/sw.js static Service Worker event inventory',
    ).toEqual(staticServiceWorkerExpectedEventTypes);
    for (const needle of staticServiceWorkerCachePolicyNeedles) {
      expect(staticServiceWorkerSource, `../public/sw.js static Service Worker cache policy ${needle}`).toContain(
        needle,
      );
    }
    expect(
      countPatternMatches(staticServiceWorkerSource, /^const CACHE_NAME = 'joessh-admin-v1';$/gm),
      '../public/sw.js static Service Worker cache name cardinality',
    ).toBe(1);
    expect(
      countPatternMatches(staticServiceWorkerSource, /^const MAX_CACHE_ENTRIES = 100;$/gm),
      '../public/sw.js static Service Worker max cache cardinality',
    ).toBe(1);
    expect(
      countPatternMatches(
        staticServiceWorkerSource,
        /^const STATIC_ASSETS = \['\/', '\/index\.html', '\/manifest\.json', '\/favicon\.svg', '\/offline\.html'];$/gm,
      ),
      '../public/sw.js static Service Worker precache asset cardinality',
    ).toBe(1);
    expect(productionShellSources['../index.html'], '../index.html Vite entry script source').toContain(
      allowedStaticShellEntrypointScript,
    );
    expectAnyPatternMatches(
      disallowedFormSubmissionPatterns,
      "<form action=\"/logout\" method=\"post\"><button>Submit</button></form>",
      'form submission markup action method guard',
    );
    expectAnyPatternMatches(
      disallowedFormSubmissionPatterns,
      "const submitKey = 'sub' + 'mit'; form[submitKey]();",
      'form submission computed submit guard',
    );
    expectAnyPatternMatches(
      disallowedFormSubmissionPatterns,
      "const { requestSubmit: submitForm } = form; submitForm();",
      'form submission destructured requestSubmit alias guard',
    );
    expectAnyPatternMatches(
      disallowedFormSubmissionPatterns,
      "(form as HTMLFormElement)['request' + 'Submit']();",
      'form submission type-cast requestSubmit computed guard',
    );
    expectAnyPatternMatches(
      disallowedFormSubmissionPatterns,
      "form.addEventListener('sub' + 'mit', () => form.submit());",
      'form submission submit event listener guard',
    );
    expectAnyPatternMatches(
      disallowedPassiveResourcePatterns,
      '<picture><source srcSet="/admin.avif" /><img src="/admin.png" /></picture>',
      'passive resource markup element guard',
    );
    expectAnyPatternMatches(
      disallowedPassiveResourcePatterns,
      '<link rel="pre' + 'load" href="/admin.json" />',
      'passive resource preload attribute guard',
    );
    expectAnyPatternMatches(
      disallowedPassiveResourcePatterns,
      "const tagName = 'im' + 'g'; document.createElement(tagName);",
      'passive resource createElement computed tag guard',
    );
    expectAnyPatternMatches(
      disallowedPassiveResourcePatterns,
      "const createKey = 'create' + 'Element'; document[createKey]('iframe');",
      'passive resource createElement computed method guard',
    );
    expectAnyPatternMatches(
      disallowedPassiveResourcePatterns,
      "const imageConstructor = window['Image']; new imageConstructor();",
      'passive resource Image constructor alias guard',
    );
    expectAnyPatternMatches(
      disallowedFileTransferPatterns,
      "const clipboardKey = 'clip' + 'board'; window.navigator[clipboardKey]?.writeText?.('secret');",
      'clipboard computed key guard',
    );
    expectAnyPatternMatches(
      disallowedFileTransferPatterns,
      "const { navigator: platformNavigator } = window; platformNavigator[`can${'Share'}`]?.({ text: 'secret' });",
      'web share destructured alias computed key guard',
    );
    expectAnyPatternMatches(
      disallowedFileTransferPatterns,
      "const urlApi = globalThis['URL']; urlApi['create' + 'ObjectURL'](blob);",
      'object URL computed key guard',
    );
    expectAnyPatternMatches(
      disallowedPrivilegedBrowserApiPatterns,
      "const geoKey = 'geo' + 'location'; window.navigator[geoKey]?.getCurrentPosition?.(() => undefined);",
      'geolocation computed key guard',
    );
    expectAnyPatternMatches(
      disallowedPrivilegedBrowserApiPatterns,
      "const { navigator: platformNavigator } = window; platformNavigator[`wake${'Lock'}`]?.request?.('screen');",
      'wake lock destructured alias computed key guard',
    );
    expectAnyPatternMatches(
      disallowedPrivilegedBrowserApiPatterns,
      "const paymentConstructor = window['Payment' + 'Request']; new paymentConstructor([], {});",
      'payment request computed key guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserFingerprintingPatterns,
      "const uaKey = 'user' + 'AgentData'; globalThis.navigator?.[uaKey]?.brands;",
      'browser fingerprinting computed key guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserFingerprintingPatterns,
      "const platformNavigator = globalThis?.navigator; platformNavigator[`user${'Agent'}Data`]?.brands;",
      'browser fingerprinting optional object alias template key guard',
    );
    expectAnyPatternMatches(
      disallowedBrowserFingerprintingPatterns,
      "screen['color' + 'Depth'];",
      'browser fingerprinting screen computed key guard',
    );
    expectAnyPatternMatches(
      disallowedMediaCanvasCapturePatterns,
      "const mediaKey = 'get' + 'UserMedia'; navigator.mediaDevices?.[mediaKey]?.({ audio: true });",
      'media capture getUserMedia computed key guard',
    );
    expectAnyPatternMatches(
      disallowedMediaCanvasCapturePatterns,
      "const captureKey = 'capture' + 'Stream'; (canvas as HTMLCanvasElement)[captureKey]();",
      'canvas capture type-cast computed key guard',
    );
    expectAnyPatternMatches(
      disallowedMediaCanvasCapturePatterns,
      "const { toDataURL: exportCanvas } = canvas; exportCanvas();",
      'canvas export destructured toDataURL alias guard',
    );
    expectAnyPatternMatches(
      disallowedMediaCanvasCapturePatterns,
      "const detectorConstructor = window['Barcode' + 'Detector']; new detectorConstructor();",
      'local recognition constructor computed key guard',
    );
    expectAnyPatternMatches(
      disallowedMediaCanvasCapturePatterns,
      "const midiKey = 'request' + 'MIDIAccess'; navigator[midiKey]?.();",
      'MIDI request computed key guard',
    );
    expectAnyPatternMatches(
      disallowedDomExpansionPatterns,
      "const shadowKey = 'attach' + 'Shadow'; element[shadowKey]({ mode: 'closed' });",
      'DOM expansion attachShadow computed key guard',
    );
    expectAnyPatternMatches(
      disallowedDomExpansionPatterns,
      "const editableKey = 'content' + 'Editable'; element[editableKey] = 'true';",
      'DOM expansion contentEditable computed key guard',
    );
    expectAnyPatternMatches(
      disallowedDomExpansionPatterns,
      "const { credentials: credentialStore } = navigator; credentialStore.get({ password: true });",
      'credential store destructured alias guard',
    );
    expectAnyPatternMatches(
      disallowedDomExpansionPatterns,
      "(document as Document)['exec' + 'Command']('copy');",
      'DOM expansion execCommand type-cast computed key guard',
    );
    expectAnyPatternMatches(
      disallowedDomExpansionPatterns,
      "const parserConstructor = window['DOM' + 'Parser']; new parserConstructor().parseFromString('<x />', 'text/html');",
      'DOM parser constructor computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNativeDialogPatterns,
      "const alertKey = 'al' + 'ert'; window[alertKey]?.('x');",
      'native dialog alert computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNativeDialogPatterns,
      "const { confirm: askUser } = window; askUser('continue?');",
      'native dialog confirm destructured alias guard',
    );
    expectAnyPatternMatches(
      disallowedNativeDialogPatterns,
      "(window as Window)['pr' + 'int']();",
      'native dialog print type-cast computed key guard',
    );
    expectAnyPatternMatches(
      disallowedNativeDialogPatterns,
      "window.addEventListener('before' + 'unload', () => undefined);",
      'native beforeunload computed event guard',
    );
    expectAnyPatternMatches(
      disallowedNativeDialogPatterns,
      "const unloadKey = 'onbefore' + 'unload'; globalThis[unloadKey] = () => 'stop';",
      'native onbeforeunload computed key guard',
    );
    expectAnyPatternMatches(
      disallowedObserverAndFrameSchedulerPatterns,
      "const rafKey = 'request' + 'AnimationFrame'; window[rafKey]?.(() => undefined);",
      'frame scheduler requestAnimationFrame computed key guard',
    );
    expectAnyPatternMatches(
      disallowedObserverAndFrameSchedulerPatterns,
      "(window as Window)['cancel' + 'IdleCallback'](1);",
      'frame scheduler cancelIdleCallback type-cast computed key guard',
    );
    expectAnyPatternMatches(
      disallowedObserverAndFrameSchedulerPatterns,
      "const observerConstructor = globalThis['Intersection' + 'Observer']; new observerConstructor(() => undefined);",
      'observer constructor computed key guard',
    );
    expectAnyPatternMatches(
      disallowedObserverAndFrameSchedulerPatterns,
      "const { queueMicrotask: scheduleMicrotask } = window; scheduleMicrotask(() => undefined);",
      'microtask scheduler destructured alias guard',
    );
    expectAnyPatternMatches(
      disallowedObserverAndFrameSchedulerPatterns,
      "const schedulerApi = globalThis['scheduler']; schedulerApi['post' + 'Task'](() => undefined);",
      'scheduler postTask object alias computed key guard',
    );
    expectAnyPatternMatches(
      disallowedDeviceSensorPatterns,
      "const sensorConstructor = window['Device' + 'MotionEvent']; new sensorConstructor('devicemotion');",
      'device sensor constructor computed key guard',
    );
    expectAnyPatternMatches(
      disallowedDeviceSensorPatterns,
      "const gamepadKey = 'get' + 'Gamepads'; (navigator as Navigator)[gamepadKey]?.();",
      'device sensor getGamepads type-cast computed key guard',
    );
    expectAnyPatternMatches(
      disallowedDeviceSensorPatterns,
      "const { vibrate: vibrateDevice } = navigator; vibrateDevice(200);",
      'device sensor vibrate destructured alias guard',
    );
    expectAnyPatternMatches(
      disallowedDeviceSensorPatterns,
      "const xrKey = 'xr'; window.navigator[xrKey]?.requestSession?.('immersive-vr');",
      'immersive hardware XR computed key guard',
    );
    expectAnyPatternMatches(
      disallowedDeviceSensorPatterns,
      "const lockKey = 'lo' + 'ck'; screen.orientation[lockKey]('landscape');",
      'screen orientation lock computed key guard',
    );
    for (const manifestKey of [
      'display_override',
      'file_handlers',
      'handle_links',
      'launch_handler',
      'prefer_related_applications',
      'protocol_handlers',
      'related_applications',
      'scope_extensions',
      'share_target',
      'url_handlers',
    ]) {
      expect(
        findManifestAppIntegrationKeys(`{"${manifestKey}": []}`, disallowedManifestAppIntegrationKeys),
        `manifest app integration ${manifestKey} guard`,
      ).toContain(manifestKey);
    }
    expect(
      findManifestAppIntegrationKeys('{"protocol_\\u0068andlers": []}', disallowedManifestAppIntegrationKeys),
      'manifest app integration escaped protocol_handlers guard',
    ).toContain('protocol_handlers');
    expect(
      findManifestAppIntegrationKeys('{"shortcuts":[{"share_target":{"action":"/share"}}]}', disallowedManifestAppIntegrationKeys),
      'manifest nested app integration share_target guard',
    ).toContain('share_target');

    for (const [sourcePath, source] of Object.entries(productionSources)) {
      expect(source, sourcePath).not.toContain(disallowedAttribute);
      for (const disallowedPattern of disallowedHtmlInjectionPatterns) {
        expect(source, `${sourcePath} raw HTML injection guard`).not.toContain(disallowedPattern);
      }
      for (const disallowedPattern of disallowedScriptExecutionPatterns) {
        expect(source, `${sourcePath} dynamic script execution guard`).not.toContain(disallowedPattern);
      }
      for (const disallowedPattern of disallowedUrlProtocolPatterns) {
        expect(source, `${sourcePath} unsafe URL protocol guard`).not.toContain(disallowedPattern);
      }
      const allowedBrowserStoragePatterns = browserStorageAllowedAccessPatterns.get(sourcePath) ?? [];
      if (allowedBrowserStoragePatterns.length === 0) {
        for (const disallowedPattern of disallowedBrowserStoragePatterns) {
          expect(source, `${sourcePath} browser storage access guard`).not.toMatch(disallowedPattern);
        }
      } else {
        for (const allowedBrowserStoragePattern of allowedBrowserStoragePatterns) {
          expect(source, `${sourcePath} audited browser storage access guard`).toMatch(allowedBrowserStoragePattern);
        }
        const sourceWithoutAllowedBrowserStorageAccess = allowedBrowserStoragePatterns.reduce(
          (candidateSource, allowedBrowserStoragePattern) => candidateSource.replace(allowedBrowserStoragePattern, ''),
          source,
        );
        for (const disallowedPattern of disallowedBrowserStoragePatterns) {
          expect(
            sourceWithoutAllowedBrowserStorageAccess,
            `${sourcePath} unaudited browser storage access guard`,
          ).not.toMatch(disallowedPattern);
        }
        expect(countPatternMatches(source, browserStorageAccessPattern), `${sourcePath} browser storage access guard`).toBe(
          allowedBrowserStoragePatterns.length,
        );
      }
      const allowedBrowserNetworkPatterns = browserNetworkAllowedAccessPatterns.get(sourcePath) ?? [];
      if (allowedBrowserNetworkPatterns.length === 0) {
        for (const disallowedPattern of disallowedNetworkPatterns) {
          expect(source, `${sourcePath} browser network access guard`).not.toMatch(disallowedPattern);
        }
      } else {
        for (const allowedBrowserNetworkPattern of allowedBrowserNetworkPatterns) {
          expect(source, `${sourcePath} audited browser network access guard`).toMatch(allowedBrowserNetworkPattern);
        }
        const sourceWithoutAllowedBrowserNetworkAccess = allowedBrowserNetworkPatterns.reduce(
          (candidateSource, allowedBrowserNetworkPattern) => candidateSource.replace(allowedBrowserNetworkPattern, ''),
          source,
        );
        for (const disallowedPattern of disallowedNetworkPatterns) {
          expect(
            sourceWithoutAllowedBrowserNetworkAccess,
            `${sourcePath} unaudited browser network access guard`,
          ).not.toMatch(disallowedPattern);
        }
        expect(countPatternMatches(source, browserNetworkAccessPattern), `${sourcePath} browser network access guard`).toBe(
          allowedBrowserNetworkPatterns.length,
        );
      }
      for (const disallowedPattern of disallowedRealtimeCommunicationPatterns) {
        expect(source, `${sourcePath} realtime browser communication guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedNavigationMutationPatterns) {
        expect(source, `${sourcePath} navigation mutation guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedCrossWindowMessagingPatterns) {
        expect(source, `${sourcePath} cross-window messaging guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedFormSubmissionPatterns) {
        expect(source, `${sourcePath} form submission guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedPassiveResourcePatterns) {
        expect(source, `${sourcePath} passive resource loading guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedFileTransferPatterns) {
        expect(source, `${sourcePath} clipboard and file transfer guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedPrivilegedBrowserApiPatterns) {
        expect(source, `${sourcePath} privileged browser API guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedContactPickerPatterns) {
        expect(source, `${sourcePath} contact picker guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedProtocolHandlerPatterns) {
        expect(source, `${sourcePath} protocol handler guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedBrowserAppIntegrationPatterns) {
        expect(source, `${sourcePath} browser app integration guard`).not.toMatch(disallowedPattern);
      }
      const allowedServiceWorkerPatterns = serviceWorkerAllowedAccessPatterns.get(sourcePath) ?? [];
      if (allowedServiceWorkerPatterns.length === 0) {
        for (const disallowedPattern of disallowedServiceWorkerPatterns) {
          expect(source, `${sourcePath} service worker registration guard`).not.toMatch(disallowedPattern);
        }
      } else {
        for (const allowedServiceWorkerPattern of allowedServiceWorkerPatterns) {
          expect(source, `${sourcePath} audited service worker registration guard`).toMatch(allowedServiceWorkerPattern);
        }
        expect(countPatternMatches(source, serviceWorkerApiAccessPattern), `${sourcePath} service worker registration guard`).toBe(
          allowedServiceWorkerPatterns.length,
        );
      }
      for (const disallowedPattern of disallowedDeviceSensorPatterns) {
        expect(source, `${sourcePath} device sensor API guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedBrowserFingerprintingPatterns) {
        expect(source, `${sourcePath} browser fingerprinting guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedMediaCanvasCapturePatterns) {
        expect(source, `${sourcePath} media and canvas capture guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedDomExpansionPatterns) {
        expect(source, `${sourcePath} DOM expansion and credential guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedNativeDialogPatterns) {
        expect(source, `${sourcePath} native browser dialog guard`).not.toMatch(disallowedPattern);
      }
      const allowedBrowserTimerPatterns = browserTimerAllowedCallPatterns.get(sourcePath) ?? [];
      if (allowedBrowserTimerPatterns.length === 0) {
        expect(source, `${sourcePath} browser timer source guard`).not.toMatch(disallowedBrowserTimerPattern);
      } else {
        for (const allowedTimerPattern of allowedBrowserTimerPatterns) {
          expect(source, `${sourcePath} audited browser timer source guard`).toMatch(allowedTimerPattern);
        }
        expect(countPatternMatches(source, browserTimerCallPattern), `${sourcePath} browser timer source guard`).toBe(
          allowedBrowserTimerPatterns.length,
        );
      }
      for (const disallowedPattern of disallowedObserverAndFrameSchedulerPatterns) {
        expect(source, `${sourcePath} observer and frame scheduler guard`).not.toMatch(disallowedPattern);
      }
      expect(source, `${sourcePath} string timer guard`).not.toMatch(disallowedStringTimerPattern);
    }
    for (const [sourcePath, source] of Object.entries(productionShellSources)) {
      expect(source, `${sourcePath} shell aria-label attribute guard`).not.toContain(disallowedAttribute);
      expect(source, `${sourcePath} shell redundant main role guard`).not.toContain('role="main"');
      const expectedScriptCount = sourcePath === '../index.html' ? 1 : 0;
      expect(
        countPatternMatches(source, staticShellScriptOpenTagPattern),
        `${sourcePath} shell static script open tag guard`,
      ).toBe(expectedScriptCount);
      expect(
        countPatternMatches(source, staticShellScriptCloseTagPattern),
        `${sourcePath} shell static script close tag guard`,
      ).toBe(expectedScriptCount);
      if (sourcePath === '../index.html') {
        expect(
          countPatternMatches(source, new RegExp(escapeRegExp(allowedStaticShellEntrypointScript), 'g')),
          `${sourcePath} shell Vite entry script guard`,
        ).toBe(1);
        for (const { label, pattern } of staticAppShellDocumentPatterns) {
          expect(countPatternMatches(source, pattern), `${sourcePath} app shell document ${label}`).toBe(1);
        }
      }
      const expectedLinkCount = sourcePath === '../index.html' ? allowedStaticShellLinkTags.length : 0;
      expect(countPatternMatches(source, staticShellLinkTagPattern), `${sourcePath} shell link tag guard`).toBe(
        expectedLinkCount,
      );
      if (sourcePath === '../index.html') {
        for (const allowedStaticShellLinkTag of allowedStaticShellLinkTags) {
          expect(
            countPatternMatches(source, new RegExp(escapeRegExp(allowedStaticShellLinkTag), 'g')),
            `${sourcePath} shell allowed link tag guard`,
          ).toBe(1);
        }
      }
      const expectedRootIdCount = sourcePath === '../index.html' ? 1 : 0;
      expect(
        countPatternMatches(source, staticShellRootIdAttributeSearchPattern),
        `${sourcePath} shell root id guard`,
      ).toBe(expectedRootIdCount);
      if (sourcePath === '../index.html') {
        expect(
          countPatternMatches(source, new RegExp(escapeRegExp(allowedStaticShellRootMount), 'g')),
          `${sourcePath} shell exact root mount guard`,
        ).toBe(1);
      }
      const expectedStyleBlockCount = staticFallbackShellSourcePaths.has(sourcePath) ? 1 : 0;
      expect(
        countPatternMatches(source, staticShellStyleBlockOpenTagPattern),
        `${sourcePath} shell style block open guard`,
      ).toBe(expectedStyleBlockCount);
      expect(
        countPatternMatches(source, staticShellStyleBlockCloseTagPattern),
        `${sourcePath} shell style block close guard`,
      ).toBe(expectedStyleBlockCount);
      for (const disallowedPattern of disallowedHtmlInjectionPatterns) {
        expect(source, `${sourcePath} shell raw HTML injection guard`).not.toContain(disallowedPattern);
      }
      for (const disallowedPattern of disallowedScriptExecutionPatterns) {
        expect(source, `${sourcePath} shell dynamic script execution guard`).not.toContain(disallowedPattern);
      }
      for (const disallowedPattern of disallowedInlineEventHandlerPatterns) {
        expect(source, `${sourcePath} shell inline event handler guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedInlineStyleAttributePatterns) {
        expect(source, `${sourcePath} shell inline style attribute guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedMetaRefreshPatterns) {
        expect(source, `${sourcePath} shell meta refresh guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedBaseElementPatterns) {
        expect(source, `${sourcePath} shell base element guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedFocusAttributePatterns) {
        expect(source, `${sourcePath} shell focus attribute guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedInteractiveAttributePatterns) {
        expect(source, `${sourcePath} shell interactive attribute guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedUrlProtocolPatterns) {
        expect(source, `${sourcePath} shell unsafe URL protocol guard`).not.toContain(disallowedPattern);
      }
      for (const disallowedPattern of disallowedRealtimeCommunicationPatterns) {
        expect(source, `${sourcePath} shell realtime browser communication guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedNavigationMutationPatterns) {
        expect(source, `${sourcePath} shell navigation mutation guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedCrossWindowMessagingPatterns) {
        expect(source, `${sourcePath} shell cross-window messaging guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedFormSubmissionPatterns) {
        expect(source, `${sourcePath} shell form submission guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedPassiveResourcePatterns) {
        expect(source, `${sourcePath} shell passive resource loading guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedFileTransferPatterns) {
        expect(source, `${sourcePath} shell clipboard and file transfer guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedPrivilegedBrowserApiPatterns) {
        expect(source, `${sourcePath} shell privileged browser API guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedContactPickerPatterns) {
        expect(source, `${sourcePath} shell contact picker guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedProtocolHandlerPatterns) {
        expect(source, `${sourcePath} shell protocol handler guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedBrowserAppIntegrationPatterns) {
        expect(source, `${sourcePath} shell browser app integration guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedBrowserFingerprintingPatterns) {
        expect(source, `${sourcePath} shell browser fingerprinting guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedDeviceSensorPatterns) {
        expect(source, `${sourcePath} shell device sensor API guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedMediaCanvasCapturePatterns) {
        expect(source, `${sourcePath} shell media and canvas capture guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedDomExpansionPatterns) {
        expect(source, `${sourcePath} shell DOM expansion and credential guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedNativeDialogPatterns) {
        expect(source, `${sourcePath} shell native browser dialog guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedObserverAndFrameSchedulerPatterns) {
        expect(source, `${sourcePath} shell observer and frame scheduler guard`).not.toMatch(disallowedPattern);
      }
    }
    for (const [sourcePath, source] of Object.entries(nonServiceWorkerShellSources)) {
      for (const disallowedPattern of disallowedBrowserStoragePatterns) {
        expect(source, `${sourcePath} non-service-worker shell browser storage guard`).not.toMatch(disallowedPattern);
      }
      for (const disallowedPattern of disallowedNetworkPatterns) {
        expect(source, `${sourcePath} non-service-worker shell browser network guard`).not.toMatch(disallowedPattern);
      }
      expect(source, `${sourcePath} non-service-worker shell browser timer guard`).not.toMatch(
        disallowedBrowserTimerPattern,
      );
      expect(source, `${sourcePath} non-service-worker shell string timer guard`).not.toMatch(disallowedStringTimerPattern);
    }
    expect(
      findManifestAppIntegrationKeys(productionShellSources['../public/manifest.json'], disallowedManifestAppIntegrationKeys),
      'manifest app integration guard',
    ).toEqual([]);
    expect(productionSources['./main.tsx'], './main.tsx contract source').toContain('aria-labelledby=');
    expect(productionSources['./main.tsx'], './main.tsx error-state source').toContain("message: t.local('web.state.error.message')");
    expect(productionSources['./main.tsx'], './main.tsx raw error detail source').not.toContain('adminError.message');
    expect(productionSources['./main.tsx'], './main.tsx error-state source').not.toContain('state.message');
    expect(productionSources['./localization.ts'], './localization.ts storage source').toContain('window.localStorage.setItem');
    expect(productionSources['./localization.ts'], './localization.ts storage source').toContain('window.localStorage.getItem');
    expect(productionSources['./main.tsx'], './main.tsx network source').toContain('loadAdminDashboard(window.fetch.bind(window)');
  }, 10_000);
});
