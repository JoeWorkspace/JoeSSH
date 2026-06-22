import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerWebOfflineSupport } from './sw-register';

function createServiceWorkerHarness() {
  const windowListeners = new Map<string, EventListener>();
  const serviceWorkerListeners = new Map<string, EventListener>();
  const registrationListeners = new Map<string, EventListener>();
  const workerListeners = new Map<string, EventListener>();
  const update = vi.fn<() => Promise<ServiceWorkerRegistration>>();
  const reload = vi.fn();
  const dispatchEvent = vi.fn();
  const installingWorker = {
    state: 'installing',
    addEventListener: vi.fn((event: string, listener: EventListener) => workerListeners.set(event, listener)),
  };
  const registration = {
    addEventListener: vi.fn((event: string, listener: EventListener) => registrationListeners.set(event, listener)),
    installing: installingWorker,
    update,
  } as unknown as ServiceWorkerRegistration;
  const serviceWorker = {
    addEventListener: vi.fn((event: string, listener: EventListener) => serviceWorkerListeners.set(event, listener)),
    controller: {},
    register: vi.fn<() => Promise<ServiceWorkerRegistration>>(() => Promise.resolve(registration)),
  };
  const targetWindow = {
    addEventListener: vi.fn((event: string, listener: EventListener, options?: AddEventListenerOptions) => {
      if (!options?.once) {
        windowListeners.set(event, listener);
        return;
      }

      let called = false;
      windowListeners.set(event, (nextEvent) => {
        if (called) return;
        called = true;
        listener(nextEvent);
      });
    }),
    dispatchEvent,
    location: {
      reload,
    },
  };
  const targetNavigator = {
    serviceWorker,
  };

  return {
    dispatchEvent,
    installingWorker,
    registration,
    registrationListeners,
    reload,
    serviceWorker,
    serviceWorkerListeners,
    targetNavigator,
    targetWindow,
    update,
    windowListeners,
    workerListeners,
  };
}

describe('registerWebOfflineSupport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips registration when service workers are unavailable', () => {
    const addEventListener = vi.fn();

    registerWebOfflineSupport({ addEventListener } as unknown as Window, {} as Navigator);

    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('registers on window load and swallows scheduled update failures', async () => {
    vi.useFakeTimers();
    const harness = createServiceWorkerHarness();
    harness.update.mockRejectedValue(new Error('update unavailable'));

    registerWebOfflineSupport(harness.targetWindow as unknown as Window, harness.targetNavigator as unknown as Navigator);
    harness.windowListeners.get('load')?.(new Event('load'));
    harness.windowListeners.get('load')?.(new Event('load'));
    await Promise.resolve();

    expect(harness.targetWindow.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true });
    expect(harness.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    expect(harness.serviceWorker.register).toHaveBeenCalledTimes(1);
    expect(harness.registration.addEventListener).toHaveBeenCalledWith('updatefound', expect.any(Function));

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(harness.update).toHaveBeenCalledTimes(1);
  });

  it('dispatches an update event when an activated worker takes over', async () => {
    const harness = createServiceWorkerHarness();

    registerWebOfflineSupport(harness.targetWindow as unknown as Window, harness.targetNavigator as unknown as Navigator);
    harness.windowListeners.get('load')?.(new Event('load'));
    await Promise.resolve();
    harness.registrationListeners.get('updatefound')?.(new Event('updatefound'));
    harness.installingWorker.state = 'activated';
    harness.workerListeners.get('statechange')?.(new Event('statechange'));

    expect(harness.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'sw-update-available' }));
  });

  it('reloads once when the service-worker controller changes', () => {
    const harness = createServiceWorkerHarness();

    registerWebOfflineSupport(harness.targetWindow as unknown as Window, harness.targetNavigator as unknown as Navigator);
    harness.serviceWorkerListeners.get('controllerchange')?.(new Event('controllerchange'));
    harness.serviceWorkerListeners.get('controllerchange')?.(new Event('controllerchange'));

    expect(harness.reload).toHaveBeenCalledTimes(1);
  });
});
