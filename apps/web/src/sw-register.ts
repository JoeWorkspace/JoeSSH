export function registerWebOfflineSupport(targetWindow: Window = window, targetNavigator: Navigator = navigator) {
  if (!('serviceWorker' in targetNavigator)) {
    return;
  }

  const serviceWorker = targetNavigator.serviceWorker;

  targetWindow.addEventListener('load', () => {
    serviceWorker
      .register('/sw.js')
      .then((registration) => {
        setInterval(() => {
          void registration.update().catch(ignoreServiceWorkerUpdateFailure);
        }, 60 * 60 * 1000);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated' && serviceWorker.controller) {
              targetWindow.dispatchEvent(new CustomEvent('sw-update-available'));
            }
          });
        });
      })
      .catch(ignoreServiceWorkerRegistrationFailure);
  }, { once: true });

  let refreshing = false;
  serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      targetWindow.location.reload();
    }
  });
}

function ignoreServiceWorkerRegistrationFailure() {
  // The app remains usable without offline support.
}

function ignoreServiceWorkerUpdateFailure() {
  // The next scheduled service-worker update can still recover.
}

if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  registerWebOfflineSupport();
}
