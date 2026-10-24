import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";

const desktopRoot = resolve(__dirname, "../../../apps/desktop");
const recovery = readFileSync(resolve(desktopRoot, "src-tauri/src/native-cache-recovery.js"), "utf8");
const register = readFileSync(resolve(desktopRoot, "src/sw-register.ts"), "utf8");
const pwaWorker = readFileSync(resolve(desktopRoot, "public/sw.js"), "utf8");
// Render the locked shell's actual prefix, including its final `})()` without
// a semicolon. This catches unsafe concatenation in the Builder append API.
const ipcInit = readFileSync(resolve(desktopRoot, "../../vendor/tauri-2.11.2/scripts/ipc-protocol.js"), "utf8")
  .replaceAll("__TEMPLATE_invoke_key__", '"synthetic-browser-test-key"')
  .replaceAll("__RAW_process_ipc_message_fn__", "value => ({contentType:'application/json',data:JSON.stringify(value)})")
  .replaceAll("__TEMPLATE_os_name__", '"windows"')
  .replaceAll("__TEMPLATE_fetch_channel_data_command__", '"synthetic-channel-fetch"');
const oldHtml = '<!doctype html><html><body><script type="module" src="/removed-main.js"></script></body></html>';
const currentHtml = '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>';
const preserved = "synthetic-upgrade-state";

type Fixture = { context: BrowserContext; page: Page; url: string; close: () => Promise<void> };

async function fixture(browser: Browser, options: { pwa?: boolean; host?: string; explicitPort?: boolean } = {}): Promise<Fixture> {
  const server: Server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/sw.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(options.pwa ? pwaWorker : `
        self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', event => {
          if (new URL(event.request.url).pathname === '/') {
            event.respondWith(caches.open('joessh-v3').then(cache => cache.match('/')));
          }
        });`);
    } else if (request.url === "/other-worker.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end("self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));");
    } else if (request.url === "/register.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(register);
    } else if (request.url === "/main.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end("import '/register.js'; document.body.append(Object.assign(document.createElement('h1'),{textContent:'Current JoeSSH fixture'}));");
    } else if (request.url === "/removed-main.js") {
      response.writeHead(404, { "Content-Type": "application/javascript" });
      response.end("");
    } else if (request.url === "/hung-main.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.write("/* deliberately pending synthetic module */");
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(request.url === "/seed" ? "<!doctype html><body>Seed</body>" : currentHtml);
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  // Map the real production origin to this ephemeral loopback server. Do not
  // broaden the production origin/port guard just to accommodate a test port.
  const isolatedBrowser = await browser.browserType().launch({
    args: [`--host-resolver-rules=MAP tauri.localhost 127.0.0.1:${address.port}`],
  });
  const url = options.host || options.explicitPort
    ? `http://${options.host ?? "tauri.localhost"}:${address.port}`
    : "http://tauri.localhost";
  const context = await isolatedBrowser.newContext({ serviceWorkers: "allow" });
  return {
    context,
    page: await context.newPage(),
    url,
    close: async () => {
      await context.close();
      await isolatedBrowser.close();
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    },
  };
}

async function seedOldWorker(f: Fixture) {
  await f.page.goto(`${f.url}/seed`);
  await f.page.evaluate(async ({ html, state }) => {
    localStorage.setItem("atlasterm.customConnections", state);
    sessionStorage.setItem("unrelated-session", state);
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open("synthetic-credentials", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolveTransaction, reject) => {
      const transaction = database.transaction("state", "readwrite");
      transaction.objectStore("state").put(state, "sentinel");
      transaction.oncomplete = () => resolveTransaction();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    for (const name of ["joessh-v1", "joessh-v2", "joessh-v3"]) {
      const cache = await caches.open(name);
      await cache.put("/", new Response(html, { headers: { "Content-Type": "text/html" } }));
    }
    const unrelatedCache = await caches.open("unrelated-cache");
    await unrelatedCache.put("/sentinel", new Response(state));
    await navigator.serviceWorker.register("/other-worker.js", { scope: "/other/" });
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  }, { html: oldHtml, state: preserved });
  await f.page.goto(f.url);
  await expect.poll(() => f.page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${f.url}/sw.js`);
  await expect(f.page.getByRole("heading", { name: "Current JoeSSH fixture" })).toHaveCount(0);
  await expect(f.page.locator("body")).toHaveText("");
}

async function expectStatePreserved(page: Page) {
  expect(await page.evaluate(() => localStorage.getItem("atlasterm.customConnections"))).toBe(preserved);
  expect(await page.evaluate(() => sessionStorage.getItem("unrelated-session"))).toBe(preserved);
  expect(await page.evaluate(async () => {
    const cache = await caches.open("unrelated-cache");
    return (await cache.match("/sentinel"))?.text();
  })).toBe(preserved);
  expect(await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open("synthetic-credentials", 1);
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolveValue, reject) => {
        const request = database.transaction("state").objectStore("state").get("sentinel");
        request.onsuccess = () => resolveValue(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  })).toBe(preserved);
}

const nativeInit = "Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{}});\n" + ipcInit + recovery;

test.describe("native startup cache recovery", () => {
  test("recovers before a missing cached main, preserving state and unrelated caches/workers", async ({ browser }) => {
    const f = await fixture(browser);
    try {
      await seedOldWorker(f);
      await f.page.addInitScript({ content: nativeInit });
      await f.page.reload();
      await expect(f.page.getByRole("heading", { name: "Current JoeSSH fixture" })).toBeVisible();
      expect(await f.page.evaluate(() => typeof (window as unknown as { __TAURI_INTERNALS__: { postMessage: unknown } }).__TAURI_INTERNALS__.postMessage)).toBe("function");
      await expect.poll(() => f.page.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
      await expect.poll(() => f.page.evaluate(() => caches.keys())).toEqual(["unrelated-cache"]);
      expect(await f.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => new URL(registration.scope).pathname))).toEqual(["/other/"]);
      expect(await f.page.evaluate(() => sessionStorage.getItem("joessh.nativeCacheRecovery.v1.reloaded"))).toBe("1");
      await expectStatePreserved(f.page);
      expect(await f.page.evaluate(async () => {
        try { await navigator.serviceWorker.register("/sw.js"); return "registered"; }
        catch (error) { return (error as Error).name; }
      })).toBe("NotSupportedError");
      await f.page.waitForTimeout(250);
      expect(await f.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).some((registration) => new URL(registration.scope).pathname === "/"))).toBe(false);
    } finally { await f.close(); }
  });

  test("a fresh native page does not register a worker", async ({ browser }) => {
    const f = await fixture(browser);
    try {
      await f.page.addInitScript({ content: nativeInit });
      await f.page.goto(f.url);
      await expect(f.page.getByRole("heading")).toBeVisible();
      await f.page.waitForTimeout(250);
      expect(await f.page.evaluate(() => navigator.serviceWorker.getRegistrations().then((registrations) => registrations.length))).toBe(0);
      expect(await f.page.evaluate(() => caches.keys())).toEqual([]);
      await expect(f.page.getByRole("alert")).toHaveCount(0);
    } finally { await f.close(); }
  });

  test("leaves browser PWA registration and real offline navigation working", async ({ browser }) => {
    const f = await fixture(browser, { pwa: true });
    try {
      await f.page.addInitScript({ content: recovery });
      await f.page.goto(f.url);
      await f.page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      // The unchanged PWA module reloads on controllerchange itself. Waiting
      // for cached modules avoids racing that real navigation with a second.
      await expect(f.page.getByRole("heading")).toBeVisible();
      await expect.poll(() => f.page.evaluate(async () => Boolean(await (await caches.open("joessh-v3")).match("/main.js")))).toBe(true);
      await expect.poll(() => f.page.evaluate(async () => Boolean(await (await caches.open("joessh-v3")).match("/register.js")))).toBe(true);
      await f.context.setOffline(true);
      await f.page.reload();
      await expect(f.page.getByRole("heading", { name: "Current JoeSSH fixture" })).toBeVisible();
      expect(await f.page.evaluate(() => caches.keys())).toContain("joessh-v3");
      await expect(f.page.getByRole("alert")).toHaveCount(0);
    } finally { await f.close(); }
  });

  test("does not recover a non-app origin even with a native marker", async ({ browser }) => {
    const f = await fixture(browser, { host: "127.0.0.1" });
    try {
      await seedOldWorker(f);
      await f.page.addInitScript({ content: nativeInit });
      await f.page.reload();
      await f.page.waitForTimeout(250);
      expect(await f.page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining(["joessh-v1", "joessh-v2", "joessh-v3"]));
      expect(await f.page.evaluate(() => sessionStorage.getItem("joessh.nativeCacheRecovery.v1.reloaded"))).toBeNull();
      await expectStatePreserved(f.page);
    } finally { await f.close(); }
  });

  test("does not treat a development port as the native app origin", async ({ browser }) => {
    const f = await fixture(browser, { explicitPort: true });
    try {
      await seedOldWorker(f);
      await f.page.addInitScript({ content: nativeInit });
      await f.page.reload();
      await f.page.waitForTimeout(250);
      expect(await f.page.evaluate(() => caches.keys())).toContain("joessh-v3");
      expect(await f.page.evaluate(() => sessionStorage.getItem("joessh.nativeCacheRecovery.v1.reloaded"))).toBeNull();
      await expectStatePreserved(f.page);
    } finally { await f.close(); }
  });

  test("a native-marked subframe cannot clean the main origin", async ({ browser }) => {
    const f = await fixture(browser);
    try {
      await seedOldWorker(f);
      await f.page.addInitScript({ content: `if(window.top!==window){${nativeInit}}` });
      await f.page.goto(`${f.url}/frame-host`);
      await f.page.evaluate(() => {
        const iframe = document.createElement("iframe");
        iframe.src = "/frame-child";
        document.body.appendChild(iframe);
      });
      const frame = f.page.frameLocator("iframe");
      await expect(frame.getByRole("heading")).toBeVisible();
      expect(await f.page.evaluate(() => Boolean((document.querySelector("iframe")?.contentWindow as unknown as { __TAURI_INTERNALS__?: unknown })?.__TAURI_INTERNALS__))).toBe(true);
      expect(await f.page.evaluate(() => caches.keys())).toContain("joessh-v3");
      expect(await f.page.evaluate(() => sessionStorage.getItem("joessh.nativeCacheRecovery.v1.reloaded"))).toBeNull();
      await expectStatePreserved(f.page);
    } finally { await f.close(); }
  });

  test("an exhausted reload guard fails visibly without deleting state or looping", async ({ browser }) => {
    const f = await fixture(browser);
    try {
      await seedOldWorker(f);
      await f.page.evaluate(() => sessionStorage.setItem("joessh.nativeCacheRecovery.v1.reloaded", "1"));
      let navigations = 0;
      f.page.on("framenavigated", (frame) => { if (frame === f.page.mainFrame()) navigations++; });
      await f.page.addInitScript({ content: nativeInit });
      await f.page.reload();
      await expect(f.page.getByRole("alert")).toContainText("Close and reopen JoeSSH");
      await f.page.waitForTimeout(300);
      expect(navigations).toBe(1);
      expect(await f.page.evaluate(() => caches.keys())).toContain("joessh-v3");
      await expectStatePreserved(f.page);
    } finally { await f.close(); }
  });

  test("unregister rejection displays safe recovery text and keeps user state", async ({ browser }) => {
    const f = await fixture(browser);
    try {
      await seedOldWorker(f);
      await f.page.evaluate(async () => {
        const cache = await caches.open("joessh-v3");
        await cache.put("/", new Response('<!doctype html><html><head><script type="module" src="/hung-main.js"></script></head><body></body></html>', { headers: { "Content-Type": "text/html" } }));
      });
      await f.page.addInitScript({ content: "ServiceWorkerRegistration.prototype.unregister=()=>Promise.reject(new Error('private-token-must-not-render'));\n" + nativeInit });
      await f.page.reload({ waitUntil: "commit" });
      await expect(f.page.getByRole("alert")).toContainText("saved connections");
      expect(await f.page.evaluate(() => document.readyState)).not.toBe("complete");
      await expect(f.page.locator("body")).not.toContainText("private-token-must-not-render");
      expect(await f.page.evaluate(() => sessionStorage.getItem("joessh.nativeCacheRecovery.v1.reloaded"))).toBeNull();
      await expectStatePreserved(f.page);
    } finally { await f.close(); }
  });

  test("unavailable reload storage fails visibly without an unguarded navigation", async ({ browser }) => {
    const f = await fixture(browser);
    try {
      await seedOldWorker(f);
      await f.page.addInitScript({ content: "const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='joessh.nativeCacheRecovery.v1.reloaded')throw new DOMException('synthetic blocked storage','SecurityError');return originalSet.call(this,key,value)};\n" + nativeInit });
      let navigations = 0;
      f.page.on("framenavigated", (frame) => { if (frame === f.page.mainFrame()) navigations++; });
      await f.page.reload();
      await expect(f.page.getByRole("alert")).toContainText("Close and reopen JoeSSH");
      await f.page.waitForTimeout(300);
      expect(navigations).toBe(1);
      expect(await f.page.evaluate(() => sessionStorage.getItem("joessh.nativeCacheRecovery.v1.reloaded"))).toBeNull();
      await expectStatePreserved(f.page);
    } finally { await f.close(); }
  });

  test("a stalled API reaches the recovery deadline instead of remaining silently blank", async ({ browser }) => {
    const f = await fixture(browser);
    try {
      await seedOldWorker(f);
      await f.page.addInitScript({ content: "navigator.serviceWorker.getRegistrations=()=>new Promise(resolve=>setTimeout(()=>resolve([]),9000));\n" + nativeInit });
      let navigations = 0;
      f.page.on("framenavigated", (frame) => { if (frame === f.page.mainFrame()) navigations++; });
      await f.page.reload();
      await expect(f.page.getByRole("alert")).toContainText("Close and reopen JoeSSH", { timeout: 10_000 });
      await f.page.waitForTimeout(1500);
      expect(navigations).toBe(1);
      expect(await f.page.evaluate(() => sessionStorage.getItem("joessh.nativeCacheRecovery.v1.reloaded"))).toBeNull();
      await expectStatePreserved(f.page);
    } finally { await f.close(); }
  });
});
