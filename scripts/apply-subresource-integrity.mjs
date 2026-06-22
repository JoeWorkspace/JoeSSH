#!/usr/bin/env node
/**
 * Adds or verifies SHA-384 Subresource Integrity attributes for built HTML.
 *
 * Usage:
 *   node scripts/apply-subresource-integrity.mjs apps/web/dist
 *   node scripts/apply-subresource-integrity.mjs --check apps/web/dist apps/desktop/dist
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const checkOnly = args[0] === '--check';
const distArgs = checkOnly ? args.slice(1) : args;
const distDirs = distArgs.length > 0 ? distArgs : ['dist'];

let failed = false;

for (const distArg of distDirs) {
  const distDir = resolve(distArg);
  const htmlPath = resolve(distDir, 'index.html');

  if (!existsSync(htmlPath)) {
    console.error(`FAIL ${distArg}: index.html was not found`);
    failed = true;
    continue;
  }

  const html = readFileSync(htmlPath, 'utf8');
  const updatedHtml = addIntegrityToHtml(html, distDir);

  if (checkOnly) {
    if (updatedHtml !== html) {
      console.error(`FAIL ${distArg}: subresource integrity attributes are missing or stale`);
      failed = true;
    } else {
      console.log(`OK   ${distArg}: subresource integrity attributes verified`);
    }
    continue;
  }

  writeFileSync(htmlPath, updatedHtml);
  console.log(`SRI applied to ${htmlPath}`);
}

if (failed) {
  process.exit(1);
}

function addIntegrityToHtml(html, distDir) {
  return html.replace(/<(script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/gi, (tag, tagName, ref) => {
    if (!shouldAddIntegrity(tagName, tag, ref)) {
      return tag;
    }

    const assetPath = getAssetPath(distDir, ref);
    if (!assetPath || !existsSync(assetPath)) {
      return tag;
    }

    const integrity = createIntegrity(assetPath);
    const withIntegrity = upsertAttribute(tag, 'integrity', integrity);
    return upsertAttribute(withIntegrity, 'crossorigin', 'anonymous');
  });
}

function shouldAddIntegrity(tagName, tag, ref) {
  const extension = extname(ref.split(/[?#]/)[0]).toLowerCase();

  if (extension !== '.js' && extension !== '.mjs' && extension !== '.css') {
    return false;
  }

  if (!ref.startsWith('/assets/') && !ref.startsWith('assets/')) {
    return false;
  }

  if (tagName.toLowerCase() === 'script') {
    return true;
  }

  const rel = tag.match(/\srel=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const relValue = `${rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? ''}`.toLowerCase();
  return relValue.split(/\s+/).some((value) => value === 'modulepreload' || value === 'stylesheet');
}

function getAssetPath(distDir, ref) {
  const cleanRef = ref.split(/[?#]/)[0].replace(/^\/+/, '');
  const assetPath = resolve(distDir, cleanRef);

  if (assetPath !== distDir && !assetPath.startsWith(`${distDir}${sep}`)) {
    return null;
  }

  return assetPath;
}

function createIntegrity(assetPath) {
  const body = readFileSync(assetPath);
  return `sha384-${createHash('sha384').update(body).digest('base64')}`;
}

function upsertAttribute(tag, name, value) {
  const attribute = ` ${name}="${value}"`;
  const pattern = new RegExp(`\\s${name}(?:=(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'i');

  if (pattern.test(tag)) {
    return tag.replace(pattern, attribute);
  }

  return tag.replace(/\s*\/?>$/, (ending) => `${attribute}${ending.trimStart()}`);
}
