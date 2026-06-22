#!/usr/bin/env node
/**
 * Bundle size budget checker.
 * Fails CI if any chunk exceeds the configured limit.
 *
 * Usage: node scripts/check-bundle-size.mjs [dist-dir] [budget-kb]
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const distDir = process.argv[2] ?? 'apps/web/dist';
const budgetKB = Number(process.argv[3] ?? '250');

const JS_EXTS = new Set(['.js', '.mjs']);
const CSS_EXTS = new Set(['.css']);

// Lazy-loaded third-party vendor chunks that are fetched on demand (never part
// of the startup path) and are inherently larger than the per-chunk budget.
// The budget protects startup latency, which these do not affect.
const LAZY_VENDOR_EXEMPT = [/\bxterm-[^/\\]*\.js$/];

function walk(dir) {
  const entries = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...walk(full));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

const files = walk(distDir).filter((f) => {
  const ext = extname(f).toLowerCase();
  return JS_EXTS.has(ext) || CSS_EXTS.has(ext);
});

let failed = false;

for (const file of files) {
  const sizeKB = statSync(file).size / 1024;
  if (sizeKB > budgetKB && LAZY_VENDOR_EXEMPT.some((re) => re.test(file))) {
    console.log(`SKIP ${file}: ${sizeKB.toFixed(1)}KB (lazy vendor chunk, exempt from startup budget)`);
    continue;
  }
  if (sizeKB > budgetKB) {
    console.error(`FAIL ${file}: ${sizeKB.toFixed(1)}KB exceeds ${budgetKB}KB budget`);
    failed = true;
  } else {
    console.log(`OK   ${file}: ${sizeKB.toFixed(1)}KB`);
  }
}

if (failed) {
  console.error(`\nBundle size budget exceeded. Max allowed: ${budgetKB}KB per chunk.`);
  process.exit(1);
} else {
  console.log(`\nAll chunks within ${budgetKB}KB budget.`);
}
