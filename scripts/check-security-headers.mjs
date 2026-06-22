#!/usr/bin/env node

/**
 * Checks that built HTML files contain required security headers.
 * Exit code 0 = all headers present, 1 = missing headers.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_META = [
  { name: 'referrer', pattern: /<meta\s+name="referrer"\s+content="strict-origin-when-cross-origin"\s*\/?>/i },
  { name: 'X-Content-Type-Options', pattern: /<meta\s+http-equiv="X-Content-Type-Options"\s+content="nosniff"\s*\/?>/i },
];

const REQUIRED_HEADERS_IN_HTML = [
  { name: 'Permissions-Policy', pattern: /Permissions-Policy.*camera=\(\).*microphone=\(\).*geolocation=\(\).*payment=\(\).*usb=\(\).*magnetometer=\(\).*gyroscope=\(\).*accelerometer=\(\)/is },
  { name: 'color-scheme meta', pattern: /<meta\s+name="color-scheme"/i },
];

const REQUIRED_CSP_DIRECTIVES = [
  { directive: 'connect-src', token: "'self'", fallbackToken: "'none'" },
  { directive: 'base-uri', token: "'self'", fallbackToken: "'none'" },
  { directive: 'form-action', token: "'self'", fallbackToken: "'none'" },
  { directive: 'object-src', token: "'none'" },
  { directive: 'upgrade-insecure-requests' },
];

const HTTP_ONLY_CSP_DIRECTIVES = ['frame-ancestors'];

const REQUIRED_DEPLOYMENT_HEADERS = [
  {
    name: 'deployment Content-Security-Policy frame-ancestors',
    pattern: /^\s*Content-Security-Policy:\s*frame-ancestors\s+'none'\s*$/im,
  },
  { name: 'deployment X-Frame-Options', pattern: /^\s*X-Frame-Options:\s*DENY\s*$/im },
  { name: 'deployment X-Content-Type-Options', pattern: /^\s*X-Content-Type-Options:\s*nosniff\s*$/im },
  { name: 'deployment Referrer-Policy', pattern: /^\s*Referrer-Policy:\s*strict-origin-when-cross-origin\s*$/im },
  {
    name: 'deployment Permissions-Policy',
    pattern:
      /^\s*Permissions-Policy:.*camera=\(\).*microphone=\(\).*geolocation=\(\).*payment=\(\).*usb=\(\).*magnetometer=\(\).*gyroscope=\(\).*accelerometer=\(\)/im,
  },
];

function getAttribute(tag, attributeName) {
  const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function getHttpEquivMetaContent(html, httpEquivName) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (getAttribute(tag, 'http-equiv')?.toLowerCase() === httpEquivName.toLowerCase()) {
      return getAttribute(tag, 'content');
    }
  }

  return undefined;
}

function parseContentSecurityPolicy(csp) {
  const directives = new Map();
  const duplicateDirectives = new Set();

  for (const directive of csp.split(';')) {
    const parts = directive.trim().split(/\s+/).filter(Boolean);
    const [name, ...tokens] = parts;
    if (name) {
      const normalizedName = name.toLowerCase();
      if (directives.has(normalizedName)) {
        duplicateDirectives.add(normalizedName);
      } else {
        directives.set(normalizedName, tokens);
      }
    }
  }

  return {
    directives,
    duplicateDirectives: [...duplicateDirectives],
  };
}

function hasRequiredDirectiveToken(tokens, token, fallbackToken) {
  return tokens.includes(token) || (fallbackToken !== undefined && tokens.includes(fallbackToken));
}

function hasWildcardSource(value) {
  return value.includes('*');
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('Usage: node check-security-headers.mjs <dist-dir> [<dist-dir>...]');
  process.exit(1);
}

let hasErrors = false;

for (const dir of dirs) {
  const headersPath = join(dir, '_headers');
  if (!existsSync(headersPath)) {
    console.error(`FAIL ${dir}/_headers: missing deployment security headers file`);
    hasErrors = true;
  } else {
    const deploymentHeaders = readFileSync(headersPath, 'utf-8');
    for (const header of REQUIRED_DEPLOYMENT_HEADERS) {
      if (!header.pattern.test(deploymentHeaders)) {
        console.error(`FAIL ${dir}/_headers: missing ${header.name}`);
        hasErrors = true;
      }
    }
  }

  const htmlFiles = readdirSync(dir).filter((f) => f.endsWith('.html'));

  for (const htmlFile of htmlFiles) {
    const html = readFileSync(join(dir, htmlFile), 'utf-8');
    const filePath = `${dir}/${htmlFile}`;

    for (const meta of REQUIRED_META) {
      if (!meta.pattern.test(html)) {
        console.error(`FAIL ${filePath}: missing ${meta.name} meta tag`);
        hasErrors = true;
      }
    }

    for (const header of REQUIRED_HEADERS_IN_HTML) {
      if (!header.pattern.test(html)) {
        console.error(`FAIL ${filePath}: missing ${header.name} header`);
        hasErrors = true;
      }
    }

    const csp = getHttpEquivMetaContent(html, 'Content-Security-Policy');
    if (!csp) {
      console.error(`FAIL ${filePath}: missing Content-Security-Policy header`);
      hasErrors = true;
      continue;
    }

    const { directives: cspDirectives, duplicateDirectives } = parseContentSecurityPolicy(csp);
    for (const directive of duplicateDirectives) {
      console.error(`FAIL ${filePath}: duplicate CSP ${directive} directive`);
      hasErrors = true;
    }
    for (const directive of HTTP_ONLY_CSP_DIRECTIVES) {
      if (cspDirectives.has(directive)) {
        console.error(`FAIL ${filePath}: CSP meta must not include HTTP-only ${directive} directive`);
        hasErrors = true;
      }
    }

    for (const { directive, fallbackToken, token } of REQUIRED_CSP_DIRECTIVES) {
      const tokens = cspDirectives.get(directive);
      if (!tokens) {
        console.error(`FAIL ${filePath}: missing CSP ${directive} directive`);
        hasErrors = true;
        continue;
      }

      if (token && !hasRequiredDirectiveToken(tokens, token, fallbackToken)) {
        const expectedToken = fallbackToken ? `${token} or ${fallbackToken}` : token;
        console.error(`FAIL ${filePath}: CSP ${directive} must include ${expectedToken}`);
        hasErrors = true;
      }

      if (directive === 'connect-src' && tokens.some(hasWildcardSource)) {
        console.error(`FAIL ${filePath}: CSP connect-src must not include wildcard sources`);
        hasErrors = true;
      }
    }
  }
}

if (hasErrors) {
  console.error('\nSecurity headers check FAILED');
  process.exit(1);
}

console.log('Security headers check PASSED');
