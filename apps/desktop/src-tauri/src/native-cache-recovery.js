/* global window, document, navigator, location, sessionStorage, caches, URL, DOMException, MutationObserver, setTimeout, clearTimeout */

// Runs at document creation, independently of HTML and potentially cached main
// modules. Do not move this into the frontend bundle: a legacy worker can keep
// that bundle from loading at all.
;(() => {
  if (window.top !== window || !("__TAURI_INTERNALS__" in window)) return;
  // WebKit's tauri: custom scheme cannot host a service worker. Windows uses
  // these exact local HTTP(S) origins; do not touch dev-server/remote contexts.
  const isAppOrigin =
    (location.protocol === "http:" || location.protocol === "https:") &&
    location.hostname === "tauri.localhost" && location.port === "";
  if (!isAppOrigin || !("serviceWorker" in navigator)) return;

  const workers = navigator.serviceWorker;
  const reloadKey = "joessh.nativeCacheRecovery.v1.reloaded";
  // These are the exact names shipped by JoeSSH; unrelated origin storage,
  // registrations and caches must survive recovery.
  const cacheNames = new Set(["joessh-v1", "joessh-v2", "joessh-v3"]);
  let finished = false;
  let timer;

  function matchesAppUrl(value, pathname) {
    try {
      const url = new URL(value, location.href);
      return (
        url.protocol === location.protocol &&
        url.host === location.host &&
        url.pathname === pathname &&
        !url.username && !url.password && !url.search && !url.hash
      );
    } catch {
      return false;
    }
  }

  function failed() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const show = () => {
      const target = document.body || document.documentElement;
      if (!target) return false;
      const alert = document.createElement("div");
      alert.setAttribute("role", "alert");
      alert.setAttribute("data-joessh-native-cache-recovery", "failed");
      alert.style.cssText = "position:fixed;inset:24px;z-index:2147483647;padding:24px;background:#fff;color:#111;font:16px/1.5 sans-serif;overflow:auto";
      alert.textContent = "JoeSSH could not refresh its local startup cache. Close and reopen JoeSSH. Your saved connections and trust data have not been cleared. / JoeSSH 无法刷新本地启动缓存。请关闭后重新打开；已保存的连接和信任数据未被清除。";
      target.appendChild(alert);
      return true;
    };
    // A missing/hung module can prevent DOMContentLoaded. Do not wait for it.
    if (!show()) {
      const observer = new MutationObserver(() => {
        if (show()) observer.disconnect();
      });
      observer.observe(document, { childList: true });
      setTimeout(() => observer.disconnect(), 1000);
    }
  }

  // An old cached entry may itself try to register again before cleanup ends.
  // Block only our own script, in this native document, synchronously.
  try {
    const register = workers.register.bind(workers);
    Object.defineProperty(workers, "register", {
      value(scriptURL, options) {
        if (matchesAppUrl(scriptURL, "/sw.js")) {
          return Promise.reject(new DOMException("Native JoeSSH uses embedded assets.", "NotSupportedError"));
        }
        return register(scriptURL, options);
      },
    });
  } catch {
    failed();
    return;
  }

  timer = setTimeout(failed, 8000);
  const check = () => {
    if (finished) throw new Error("Native cache recovery stopped.");
  };
  void (async () => {
    const controller = workers.controller;
    if (controller && !matchesAppUrl(controller.scriptURL, "/sw.js")) {
      throw new Error("Unrecognized native controller.");
    }
    const registrations = await workers.getRegistrations();
    check();
    if (registrations.length > 128) throw new Error("Too many registrations.");
    const owned = registrations.filter((registration) => {
      const scripts = [registration.active, registration.waiting, registration.installing].filter(Boolean);
      return matchesAppUrl(registration.scope, "/") && scripts.length > 0 &&
        scripts.every((worker) => matchesAppUrl(worker.scriptURL, "/sw.js"));
    });
    const existingCaches = await caches.keys();
    check();
    if (existingCaches.length > 128) throw new Error("Too many caches.");
    const ownedCaches = existingCaches.filter((name) => cacheNames.has(name));
    const needsReload = Boolean(controller) || owned.length > 0;
    if (needsReload && sessionStorage.getItem(reloadKey) === "1") {
      throw new Error("Native cache recovery already reloaded.");
    }
    for (const registration of owned) {
      if (!(await registration.unregister())) throw new Error("Unregister failed.");
      check();
    }
    for (const name of ownedCaches) {
      await caches.delete(name);
      check();
    }
    if (needsReload) {
      sessionStorage.setItem(reloadKey, "1");
      if (sessionStorage.getItem(reloadKey) !== "1") throw new Error("Reload guard unavailable.");
      check();
      location.reload();
      // A successful navigation destroys this document/timer. If navigation is
      // blocked, the original deadline still produces a visible failure.
      return;
    }
    finished = true;
    clearTimeout(timer);
  })().catch(failed);
})();
