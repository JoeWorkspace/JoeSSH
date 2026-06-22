import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const CHECKER_PATH = fileURLToPath(new URL('./check-security-headers.mjs', import.meta.url));
const STRICT_CSP =
  "default-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests";
const STRICT_DEPLOYMENT_HEADERS = `/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
`;

function htmlWithCsp(csp) {
  return `<!doctype html>
<html>
  <head>
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <meta http-equiv="X-Content-Type-Options" content="nosniff" />
    <meta name="color-scheme" content="light dark" />
    <meta http-equiv="Permissions-Policy" content="camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
  </head>
  <body></body>
</html>`;
}

function createFixture(t, csp, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'security-headers-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(join(root, 'index.html'), htmlWithCsp(csp), 'utf8');
  if (options.deploymentHeaders !== null) {
    writeFileSync(join(root, '_headers'), options.deploymentHeaders ?? STRICT_DEPLOYMENT_HEADERS, 'utf8');
  }

  return root;
}

function runChecker(root) {
  return spawnSync(process.execPath, [CHECKER_PATH, root], {
    encoding: 'utf8',
  });
}

test('passes a strict security header fixture', (t) => {
  const result = runChecker(createFixture(t, STRICT_CSP));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Security headers check PASSED/);
});

test('rejects duplicate CSP directives instead of accepting later values', (t) => {
  const result = runChecker(
    createFixture(
      t,
      "default-src 'self'; connect-src https://api.example.test; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
    ),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate CSP connect-src directive/);
  assert.match(result.stderr, /CSP connect-src must include 'self' or 'none'/);
});

test('rejects HTTP-only CSP directives in meta tags', (t) => {
  const result = runChecker(createFixture(t, `${STRICT_CSP}; frame-ancestors 'none'`));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CSP meta must not include HTTP-only frame-ancestors directive/);
});

test('rejects missing deployment security headers', (t) => {
  const result = runChecker(createFixture(t, STRICT_CSP, { deploymentHeaders: null }));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing deployment security headers file/);
});

test('rejects deployment headers without clickjacking protection', (t) => {
  const result = runChecker(
    createFixture(t, STRICT_CSP, {
      deploymentHeaders: STRICT_DEPLOYMENT_HEADERS.replace(
        "  Content-Security-Policy: frame-ancestors 'none'\n  X-Frame-Options: DENY\n",
        '',
      ),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing deployment Content-Security-Policy frame-ancestors/);
  assert.match(result.stderr, /missing deployment X-Frame-Options/);
});

test('rejects wildcard connect-src source expressions', (t) => {
  for (const source of ['*', 'https://*', 'wss://*', '*.example.test']) {
    const result = runChecker(
      createFixture(t, STRICT_CSP.replace("connect-src 'self'", `connect-src 'self' ${source}`)),
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /CSP connect-src must not include wildcard sources/);
  }
});
