import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  WEB_ADMIN_BUNDLE_FORBIDDEN_NEEDLES,
  formatWebAdminBundleTokenLeaks,
  scanWebAdminBundleForTokenLeaks,
} from './check-web-admin-bundle-token-scan.mjs';

test('passes when Web Admin dist files do not contain admin snapshot token markers', () => {
  const root = createFixtureDist();
  try {
    writeFileSync(join(root, 'index.html'), '<script src="/assets/app.js"></script>');
    mkdirSync(join(root, 'assets'));
    writeFileSync(
      join(root, 'assets', 'app.js'),
      [
        'fetch("/api/admin/snapshot", { headers: { Accept: "application/json" } });',
        'const chunkHash = "0123456789abcdefghijklmnopqrstuvwxyzABCDEF";',
        'const integrity = "sha384-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/=";',
      ].join('\n'),
    );

    const result = scanWebAdminBundleForTokenLeaks(root);

    assert.equal(result.filesScanned, 2);
    assert.deepEqual(result.leaks, []);
    assert.match(formatWebAdminBundleTokenLeaks(result), /OK Web Admin bundle token scan passed \(2 files\)\./);
  } finally {
    rmFixtureDist(root);
  }
});

test('reports token env names, bearer literals, and high-entropy credential literals', () => {
  const root = createFixtureDist();
  try {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'env.js'), 'const leaked = "ATLASTERM_SYNC_ADMIN_TOKEN";');
    writeFileSync(join(root, 'assets', 'auth.js'), 'fetch("/api", { headers: { Authorization: "Bearer live-token-0123456789abcdef" } });');
    writeFileSync(
      join(root, 'assets', 'secret.js'),
      'const adminSecret = "0123456789abcdefghijklmnopqrstuvwxyzABCDEF";',
    );

    const result = scanWebAdminBundleForTokenLeaks(root);

    assert.deepEqual(result.leaks, [
      {
        filePath: 'assets/auth.js',
        label: 'bearer token literal',
      },
      {
        filePath: 'assets/env.js',
        label: 'JoeSSH token environment variable name',
      },
      {
        filePath: 'assets/secret.js',
        label: 'high-entropy credential literal',
      },
    ]);
    assert.match(formatWebAdminBundleTokenLeaks(result), /assets\/auth\.js: bearer token literal/);
    assert.match(formatWebAdminBundleTokenLeaks(result), /assets\/env\.js: JoeSSH token environment variable name/);
    assert.match(formatWebAdminBundleTokenLeaks(result), /assets\/secret\.js: high-entropy credential literal/);
  } finally {
    rmFixtureDist(root);
  }
});

test('reports legacy admin snapshot env names and sentinel token values in Web Admin dist files', () => {
  const root = createFixtureDist();
  try {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'app.js'), `const envName = "${WEB_ADMIN_BUNDLE_FORBIDDEN_NEEDLES[0].value}";`);
    writeFileSync(join(root, 'assets', 'chunk.js'), `const token = "${WEB_ADMIN_BUNDLE_FORBIDDEN_NEEDLES[1].value}";`);

    const result = scanWebAdminBundleForTokenLeaks(root);

    assert.deepEqual(result.leaks, [
      {
        filePath: 'assets/app.js',
        label: 'legacy admin snapshot auth env name',
      },
      {
        filePath: 'assets/chunk.js',
        label: 'admin snapshot sentinel token',
      },
    ]);
    assert.match(formatWebAdminBundleTokenLeaks(result), /assets\/app\.js: legacy admin snapshot auth env name/);
    assert.match(formatWebAdminBundleTokenLeaks(result), /assets\/chunk\.js: admin snapshot sentinel token/);
  } finally {
    rmFixtureDist(root);
  }
});

function createFixtureDist() {
  return mkdtempSync(join(tmpdir(), 'web-admin-token-scan-'));
}

function rmFixtureDist(root) {
  if (!root.startsWith(tmpdir())) {
    throw new Error(`Refusing to remove non-temp fixture directory: ${root}`);
  }
  rmSync(root, { force: true, recursive: true });
}
