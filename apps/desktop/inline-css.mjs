import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const distDir = join(process.cwd(), 'dist');
const assetsDir = join(distDir, 'assets');
const htmlPath = join(distDir, 'index.html');
let html = readFileSync(htmlPath, 'utf-8');

// Inline CSS files from assets directory
const cssFiles = readdirSync(assetsDir).filter(f => f.endsWith('.css'));
for (const cssFile of cssFiles) {
  const cssContent = readFileSync(join(assetsDir, cssFile), 'utf-8');
  const linkRegex = new RegExp(`<link[^>]*href="[^"]*${cssFile}"[^>]*>`);
  html = html.replace(linkRegex, `<style>${cssContent}</style>`);
}

// Remove duplicate modulepreload hints (keep first occurrence)
const seen = new Set();
html = html.replace(/<link rel="modulepreload"[^>]*>/g, (match) => {
  const hrefMatch = match.match(/href="([^"]+)"/);
  if (hrefMatch && seen.has(hrefMatch[1])) return '';
  if (hrefMatch) seen.add(hrefMatch[1]);
  return match;
});

// Add fetchpriority="high" to main script tag
html = html.replace(
  /<script type="module" crossorigin src="([^"]+)"><\/script>/,
  '<script type="module" crossorigin src="$1" fetchpriority="high"></script>'
);

// Add modulepreload hints for critical chunks (vendor + icons)
const jsFiles = readdirSync(assetsDir).filter(f => f.endsWith('.js'));
const vendorFile = jsFiles.find(f => f.startsWith('vendor-'));
const iconsFile = jsFiles.find(f => f.startsWith('icons-'));

if (vendorFile || iconsFile) {
  const preloadHints = [vendorFile, iconsFile]
    .filter(f => f && !seen.has(`/assets/${f}`))
    .map(f => `<link rel="modulepreload" href="/assets/${f}">`)
    .join('\n    ');
  if (preloadHints) {
    html = html.replace('</head>', `    ${preloadHints}\n  </head>`);
  }
}

// Inject a lightweight skeleton into #root for faster FCP (paints before React mounts)
const skeleton = `<div class="workbench" aria-hidden="true" style="pointer-events:none"><div class="sidebar"><div class="brand-row"><div class="brand-mark skeleton" style="width:38px;height:38px"></div><div><div class="skeleton skeleton--text" style="width:100px;margin-bottom:6px"></div><div class="skeleton skeleton--text-sm" style="width:60px"></div></div></div><div class="search-field"><div class="skeleton skeleton--text" style="width:100%"></div></div><div class="connection-list">${Array(4).fill(0).map(() => '<div class="connection-card"><div class="connection-card-main"><div class="skeleton skeleton--circle"></div><div><div class="skeleton skeleton--text" style="width:120px;margin-bottom:4px"></div><div class="skeleton skeleton--text-sm" style="width:80px"></div></div><div class="skeleton skeleton--text-sm" style="width:30px"></div></div></div>').join('')}</div></div><div class="terminal-zone"><div class="topbar"><div class="session-title"><div class="skeleton skeleton--text" style="width:140px;margin-bottom:4px"></div><div class="skeleton skeleton--text-sm" style="width:90px"></div></div><div class="topbar-actions"><div class="skeleton skeleton--text" style="width:80px;height:28px;border-radius:7px"></div></div></div><div class="terminal-pane" style="flex:1;margin:10px"><pre style="opacity:.4"><code>${Array(8).fill(0).map(() => '<span class="skeleton skeleton--text" style="width:' + (100 + Math.floor(Math.random() * 200)) + 'px;display:block;margin-bottom:6px"></span>').join('')}</code></pre></div></div><div class="context-pane"><div class="skeleton skeleton--text" style="width:100px;margin-bottom:12px"></div><div class="skeleton skeleton--card">${Array(3).fill(0).map(() => '<div class="skeleton-row"><div class="skeleton skeleton--text" style="width:70px"></div><div class="skeleton skeleton--text" style="width:50px"></div></div>').join('')}</div></div></div>`;
html = html.replace(/<div id="root"><\/div>/, `<div id="root">${skeleton}</div>`);

writeFileSync(htmlPath, html);
console.log('CSS inlined, fetchpriority added, modulepreload hints added, skeleton injected');
