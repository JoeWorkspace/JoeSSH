import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ADMIN_BUNDLE_FORBIDDEN_NEEDLES = Object.freeze([
  {
    label: 'legacy admin snapshot auth env name',
    value: 'VITE_ATLASTERM_ADMIN_SNAPSHOT_AUTH_TOKEN',
  },
  {
    label: 'admin snapshot sentinel token',
    value: 'atlasterm-admin-snapshot-sentinel-token',
  },
]);

export function scanWebAdminBundleForTokenLeaks(
  distDir = 'apps/web/dist',
  forbiddenNeedles = WEB_ADMIN_BUNDLE_FORBIDDEN_NEEDLES,
) {
  const root = resolve(distDir);
  if (!existsSync(root)) {
    throw new Error(`Web Admin dist directory was not found: ${distDir}`);
  }

  const files = collectFiles(root);
  const leaks = [];

  for (const filePath of files) {
    const contents = readFileSync(filePath);
    for (const needle of forbiddenNeedles) {
      if (contents.indexOf(Buffer.from(needle.value, 'utf8')) >= 0) {
        leaks.push({
          filePath: relative(root, filePath).replace(/\\/g, '/'),
          label: needle.label,
        });
      }
    }

    if (isTextLikeWebAsset(filePath)) {
      leaks.push(
        ...scanWebAdminTextForTokenLeaks(contents.toString('utf8'), relative(root, filePath).replace(/\\/g, '/')),
      );
    }
  }

  return {
    filesScanned: files.length,
    leaks: dedupeLeaks(leaks),
  };
}

export function formatWebAdminBundleTokenLeaks(scanResult) {
  if (scanResult.leaks.length === 0) {
    return `OK Web Admin bundle token scan passed (${scanResult.filesScanned} files).`;
  }

  return [
    'Web Admin bundle token scan failed:',
    ...scanResult.leaks.map((leak) => `- ${leak.filePath}: ${leak.label}`),
  ].join('\n');
}

function collectFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const entryPath = resolve(root, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (stats.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

export function scanWebAdminTextForTokenLeaks(contents, filePath) {
  const leaks = [];
  const envTokenPattern = /\b(?:VITE_)?ATLASTERM_[A-Z0-9_]*TOKEN[A-Z0-9_]*\b/g;
  const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/g;

  const envTokenNames = [...contents.matchAll(envTokenPattern)].map((match) => match[0]);
  if (envTokenNames.some((name) => name !== 'VITE_ATLASTERM_ADMIN_SNAPSHOT_AUTH_TOKEN')) {
    leaks.push({
      filePath,
      label: 'JoeSSH token environment variable name',
    });
  }

  if (bearerPattern.test(contents)) {
    leaks.push({
      filePath,
      label: 'bearer token literal',
    });
  }

  if (hasCredentialContextHighEntropyLiteral(contents)) {
    leaks.push({
      filePath,
      label: 'high-entropy credential literal',
    });
  }

  return leaks;
}

function hasCredentialContextHighEntropyLiteral(contents) {
  return contents.split(/\r?\n/).some((line) => {
    if (!/(?:auth(?:orization)?|bearer|credential|password|secret|token|api[_-]?key)/i.test(line)) {
      return false;
    }

    return [...line.matchAll(/["'`]([A-Za-z0-9._~+/=-]{32,})["'`]/g)].some((match) => {
      const value = match[1];
      return shannonEntropy(value) >= 4.2 && uniqueCharacterCount(value) >= 12;
    });
  });
}

function shannonEntropy(value) {
  const counts = new Map();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function uniqueCharacterCount(value) {
  return new Set(value).size;
}

function isTextLikeWebAsset(filePath) {
  const name = basename(filePath);
  if (name === '_headers' || name === 'security.txt') {
    return true;
  }

  return new Set([
    '.css',
    '.html',
    '.js',
    '.json',
    '.map',
    '.mjs',
    '.svg',
    '.txt',
    '.webmanifest',
    '.xml',
  ]).has(extname(filePath).toLowerCase());
}

function dedupeLeaks(leaks) {
  const seen = new Set();
  return leaks
    .filter((leak) => {
      const key = `${leak.filePath}\0${leak.label}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => `${left.filePath}\0${left.label}`.localeCompare(`${right.filePath}\0${right.label}`));
}

function isMainModule() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  try {
    const scanResult = scanWebAdminBundleForTokenLeaks(process.argv[2]);
    const message = formatWebAdminBundleTokenLeaks(scanResult);
    if (scanResult.leaks.length > 0) {
      console.error(message);
      process.exitCode = 1;
    } else {
      console.log(message);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
