const fs = require('fs');
const path = require('path');

// Base locale file
const baseLocalePath = 'packages/i18n/src/locales/zh-CN.ts';
const baseContent = fs.readFileSync(baseLocalePath, 'utf8');

// Extract all translation keys from zhCN
const zhCNKeys = new Set();
const keyMatches = baseContent.match(/"([^"]+)":/g);
if (keyMatches) {
  keyMatches.forEach(m => {
    const key = m.slice(1, -2); // Remove quotes and colon
    zhCNKeys.add(key);
  });
}

if (zhCNKeys.size === 0) {
  console.log("ERROR: Could not extract translation keys from zh-CN locale file");
  process.exit(1);
}

// Map locale codes to file names.
const localeMap = {
  "zh-CN": { file: "zh-CN.ts" },
  "zh-TW": { file: "zh-TW.ts" },
  "en": { file: "en.ts" },
  "ja": { file: "ja.ts" },
  "ko": { file: "ko.ts" },
  "de": { file: "de.ts" },
  "fr": { file: "fr.ts" },
  "es": { file: "es.ts" },
  "pt-BR": { file: "pt-BR.ts" },
  "ru": { file: "ru.ts" },
  "ar": { file: "ar.ts" },
  "hi": { file: "hi.ts" },
  "id": { file: "id.ts" },
  "vi": { file: "vi.ts" },
  "th": { file: "th.ts" }
};

// Extract and check each locale
const results = [];

for (const [localeCode, { file }] of Object.entries(localeMap)) {
  const localePath = path.join('packages/i18n/src/locales', file);

  if (!fs.existsSync(localePath)) {
    results.push({
      locale: localeCode,
      found: false,
      coverage: 0,
      missing: Array.from(zhCNKeys).slice(0, 3)
    });
    continue;
  }

  const localeContent = fs.readFileSync(localePath, 'utf8');

  const localeKeys = new Set();
  const localeKeyMatches = localeContent.match(/"([^"]+)":/g);
  if (localeKeyMatches) {
    localeKeyMatches.forEach(m => {
      const key = m.slice(1, -2);
      localeKeys.add(key);
    });
  }

  const missing = Array.from(zhCNKeys).filter(k => !localeKeys.has(k));
  const coverage = Math.round(((zhCNKeys.size - missing.length) / zhCNKeys.size) * 100);

  results.push({
    locale: localeCode,
    found: true,
    coverage: coverage,
    missing: missing.slice(0, 5),
    missingCount: missing.length,
    totalExpected: zhCNKeys.size
  });
}

console.log("\n=== TRANSLATION KEY COVERAGE AUDIT ===\n");
console.log(`Base locale (zh-CN) has ${zhCNKeys.size} keys\n`);
console.log("Per-Locale Report:");
console.log("─".repeat(80));

let allComplete = true;
results.forEach(r => {
  if (r.found) {
    const status = r.missingCount === 0 ? "✓ COMPLETE" : `✗ ${r.missingCount} missing`;
    console.log(`\n${r.locale} | ${r.coverage}% (${r.totalExpected - r.missingCount}/${r.totalExpected})`);
    console.log(`  Status: ${status}`);
    if (r.missing.length > 0) {
      console.log(`  Sample missing: ${r.missing.join(", ")}`);
      allComplete = false;
    }
  } else {
    console.log(`\n${r.locale} | NOT FOUND`);
    allComplete = false;
  }
});

console.log("\n" + "─".repeat(80));

if (!allComplete) {
  console.log("\n⚠ Some locales have missing translations");
  process.exit(1);
} else {
  console.log("\n✓ All locales have complete translations");
}
