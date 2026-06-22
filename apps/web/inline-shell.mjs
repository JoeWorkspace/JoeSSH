import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const htmlPath = join(process.cwd(), 'dist', 'index.html');
let html = readFileSync(htmlPath, 'utf8');

const criticalShellStyle = [
  '<style data-joessh-critical-shell>',
  ':root{color-scheme:light dark;--web-bg:#edf2f7;--web-nav-bg:#101820;--web-surface:#fff;--web-border:#d8e0ec}',
  '@media (prefers-color-scheme:dark){:root{--web-bg:#0d1117;--web-nav-bg:#010409;--web-surface:#161b22;--web-border:#30363d}}',
  'body{margin:0;min-width:320px;min-height:100vh;background:var(--web-bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
  '.adminShellSkeleton{display:grid;grid-template-columns:232px 1fr;min-height:100vh;color:#e6edf3;pointer-events:none}',
  '.adminShellSkeleton__sidebar{background:var(--web-nav-bg);padding:24px 16px}',
  '.adminShellSkeleton__brand{font-size:18px;font-weight:800;margin-bottom:28px}',
  '.adminShellSkeleton__nav{display:grid;gap:10px}',
  '.adminShellSkeleton__nav span,.adminShellSkeleton__line,.adminShellSkeleton__card{background:linear-gradient(90deg,rgba(148,163,184,.18),rgba(148,163,184,.34),rgba(148,163,184,.18));border-radius:8px;display:block}',
  '.adminShellSkeleton__nav span{height:42px}',
  '.adminShellSkeleton__main{display:grid;gap:20px;padding:28px;color:#101820}',
  '.adminShellSkeleton__top{display:flex;gap:16px;justify-content:space-between}',
  '.adminShellSkeleton__line{height:18px}.adminShellSkeleton__line--wide{height:34px;max-width:460px}.adminShellSkeleton__line--short{max-width:180px}',
  '.adminShellSkeleton__stack{display:grid;gap:10px;min-width:0;flex:1}.adminShellSkeleton__refresh{height:42px;width:42px}',
  '.adminShellSkeleton__grid{display:grid;gap:16px;grid-template-columns:repeat(3,minmax(0,1fr))}.adminShellSkeleton__card{min-height:116px;border:1px solid var(--web-border);background-color:var(--web-surface)}',
  '@media (max-width:760px){.adminShellSkeleton{grid-template-columns:1fr}.adminShellSkeleton__sidebar{display:none}.adminShellSkeleton__main{padding:20px}.adminShellSkeleton__grid{grid-template-columns:1fr}}',
  '</style>',
].join('');

const shell = [
  '<div class="adminShellSkeleton" aria-hidden="true">',
  '<aside class="adminShellSkeleton__sidebar">',
  '<div class="adminShellSkeleton__brand">JoeSSH</div>',
  '<div class="adminShellSkeleton__nav"><span></span><span></span><span></span><span></span><span></span></div>',
  '</aside>',
  '<main class="adminShellSkeleton__main">',
  '<div class="adminShellSkeleton__top">',
  '<div class="adminShellSkeleton__stack"><span class="adminShellSkeleton__line adminShellSkeleton__line--short"></span><span class="adminShellSkeleton__line adminShellSkeleton__line--wide"></span></div>',
  '<span class="adminShellSkeleton__line adminShellSkeleton__refresh"></span>',
  '</div>',
  '<section class="adminShellSkeleton__grid"><span class="adminShellSkeleton__card"></span><span class="adminShellSkeleton__card"></span><span class="adminShellSkeleton__card"></span></section>',
  '<section class="adminShellSkeleton__grid"><span class="adminShellSkeleton__card"></span><span class="adminShellSkeleton__card"></span><span class="adminShellSkeleton__card"></span></section>',
  '</main>',
  '</div>',
].join('');

if (!html.includes('data-joessh-critical-shell')) {
  html = html.replace('</head>', `    ${criticalShellStyle}\n  </head>`);
}

html = html.replace(/<div id="root"><\/div>/, `<div id="root">${shell}</div>`);

writeFileSync(htmlPath, html);
console.log('Web Admin critical shell injected');
