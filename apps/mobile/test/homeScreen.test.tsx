import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";

import type { RegisteredDevice, SyncError, SyncPreview } from "@/models/sync";

import { setColorScheme, setWindowDimensions } from "./reactNativeMock";

const syncMocks = vi.hoisted(() => ({
  asSyncError: vi.fn(),
  fetchSyncPreview: vi.fn(),
  getOfflineError: vi.fn(),
  pushMobilePresenceCheckpoint: vi.fn(),
  registerDevice: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {
        locale: "en-US",
      },
    },
  },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storageMocks,
}));

vi.mock("@/services/sync", () => ({
  asSyncError: syncMocks.asSyncError,
  fetchSyncPreview: syncMocks.fetchSyncPreview,
  getOfflineError: syncMocks.getOfflineError,
  pushMobilePresenceCheckpoint: syncMocks.pushMobilePresenceCheckpoint,
  registerDevice: syncMocks.registerDevice,
}));

import { loadLocale } from "@atlasterm/i18n";
import HomeScreen from "../app/index";
import { MobileLocaleProvider } from "../services/localeContext";

describe("mobile home screen sync states", () => {
  beforeAll(async () => {
    await loadLocale("en");
  });

  beforeEach(() => {
    setColorScheme("light");
    setWindowDimensions({ fontScale: 1, height: 700, scale: 2, width: 320 });
    syncMocks.asSyncError.mockImplementation((error) => error);
    syncMocks.fetchSyncPreview.mockReset();
    syncMocks.getOfflineError.mockReset();
    syncMocks.pushMobilePresenceCheckpoint.mockReset();
    syncMocks.registerDevice.mockReset();
    storageMocks.getItem.mockReset();
    storageMocks.setItem.mockReset();
    storageMocks.getItem.mockResolvedValue(null);
    storageMocks.setItem.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the idle sync preview shell before registration", async () => {
    const screen = await renderHomeScreen();

    expect(textContent(screen.root)).toContain("Ready to connect");
    expect(textContent(screen.root)).toContain("Register and Pull Preview");
    expect(textContent(screen.root)).toContain("No workspace pulled yet");
    expect(textContent(screen.root)).toContain(
      "Emergency routes appear after the first preview.",
    );
    expect(
      hostByTestId(screen.root, "sync-primary-action").props.disabled,
    ).toBe(false);
    expect(hostNodesByTestId(screen.root, "sync-error-panel")).toHaveLength(0);
  });

  it("restores and persists explicit language choices", async () => {
    storageMocks.getItem.mockResolvedValueOnce("ar");
    const screen = await renderHomeScreen();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      flattenStyle(hostByTestId(screen.root, "language-option-ar").props.style)
        .backgroundColor,
    ).toBe("#087e66");
    expect(
      flattenStyle(hostByTestId(screen.root, "sync-status-panel").props.style)
        .flexDirection,
    ).toBe("row-reverse");

    await act(async () => {
      hostByTestId(screen.root, "language-option-en").props.onPress();
      await Promise.resolve();
    });

    expect(storageMocks.getItem).toHaveBeenCalledWith(
      "atlasterm.mobile.language",
    );
    expect(storageMocks.setItem).toHaveBeenCalledWith(
      "atlasterm.mobile.language",
      "en",
    );
    expect(textContent(screen.root)).toContain("English");
  });

  it("keeps language changes responsive when preference persistence fails", async () => {
    storageMocks.setItem.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    const screen = await renderHomeScreen();

    await act(async () => {
      hostByTestId(screen.root, "language-option-ar").props.onPress();
      await Promise.resolve();
    });

    expect(storageMocks.setItem).toHaveBeenCalledWith(
      "atlasterm.mobile.language",
      "ar",
    );
    expect(
      flattenStyle(hostByTestId(screen.root, "language-option-ar").props.style)
        .backgroundColor,
    ).toBe("#087e66");
  });

  it("renders the device status surface with dark theme colors when the OS is dark", async () => {
    setColorScheme("dark");
    const screen = await renderHomeScreen();

    expect(textContent(screen.root)).toContain("Ready to connect");
    expect(
      flattenStyle(hostByTestId(screen.root, "mobile-home-root").props.style)
        .backgroundColor,
    ).toBe("#080d12");
    expect(
      flattenStyle(hostByTestId(screen.root, "sync-status-panel").props.style)
        .backgroundColor,
    ).toBe("#111923");
    expect(
      flattenStyle(textByContent(screen.root, "Ready to connect").props.style)
        .color,
    ).toBe("#f2f7f8");
    expect(
      flattenStyle(
        textByContent(
          screen.root,
          "Start by registering this phone and pulling a safe preview from JoeSSH sync.",
        ).props.style,
      ).color,
    ).toBe("#a2b1ba");
  });

  it("adapts spacing across compact and tablet widths while keeping touch targets accessible", async () => {
    const viewports = [
      { height: 568, padding: 14, stackedMetrics: true, width: 320 },
      { height: 844, padding: 20, stackedMetrics: false, width: 390 },
      { height: 932, padding: 20, stackedMetrics: false, width: 430 },
      { height: 1024, padding: 32, stackedMetrics: false, width: 768 },
    ] as const;

    for (const viewport of viewports) {
      setWindowDimensions({
        fontScale: 1,
        height: viewport.height,
        width: viewport.width,
      });
      const screen = await renderHomeScreen();
      const rootScrollView = screen.root.findAll(
        (node) => node.props.automaticallyAdjustsScrollIndicatorInsets === true,
      )[0];
      const primaryActionStyle = hostByTestId(
        screen.root,
        "sync-primary-action",
      ).props.style({
        pressed: false,
      });

      expect(
        flattenStyle(rootScrollView.props.contentContainerStyle)
          .paddingHorizontal,
      ).toBe(viewport.padding);
      expect(
        flattenStyle(hostByTestId(screen.root, "sync-metrics-grid").props.style)
          .flexDirection,
      ).toBe(viewport.stackedMetrics ? "column" : "row");
      expect(flattenStyle(primaryActionStyle).minHeight).toBe(54);
      expect(
        flattenStyle(
          hostByTestId(screen.root, "language-option-en").props.style,
        ).minHeight,
      ).toBe(56);

      if (viewport.width === 768) {
        expect(
          flattenStyle(
            hostByTestId(screen.root, "sync-detail-grid").props.style,
          ).flexDirection,
        ).toBe("row");
      }

      await act(async () => {
        screen.unmount();
      });
    }
  });

  it("exposes coherent keyboard and screen-reader semantics", async () => {
    const screen = await renderHomeScreen();
    const statusPanel = hostByTestId(screen.root, "sync-status-panel");
    const primaryAction = hostByTestId(screen.root, "sync-primary-action");
    const englishOption = hostByTestId(screen.root, "language-option-en");
    const languageGroup = screen.root.findAll(
      (node) =>
        node.props.accessibilityRole === "radiogroup" &&
        typeof node.type === "string",
    )[0];

    expect(statusPanel.props.accessible).toBe(true);
    expect(statusPanel.props.accessibilityLiveRegion).toBe("polite");
    expect(statusPanel.props.accessibilityState).toEqual({ busy: false });
    expect(statusPanel.props.accessibilityLabel).toContain("Ready to connect");
    expect(statusPanel.props.accessibilityLabel).toContain(
      "Start by registering this phone",
    );
    expect(primaryAction.props.accessibilityRole).toBe("button");
    expect(primaryAction.props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });
    expect(primaryAction.props.focusable).toBe(true);
    expect(languageGroup.props.accessibilityLabel).toBe("Display language");
    expect(englishOption.props.accessibilityRole).toBe("radio");
    expect(englishOption.props.accessibilityState).toEqual({
      checked: false,
      selected: false,
    });
    expect(englishOption.props.focusable).toBe(true);
    expect(
      textByContent(screen.root, "Sync and emergency access").props
        .accessibilityRole,
    ).toBe("header");
  });

  it("uses an expanded layout for large text without shrinking interactive targets", async () => {
    setWindowDimensions({
      fontScale: 2,
      height: 844,
      width: 390,
    });
    syncMocks.registerDevice.mockResolvedValue(onlineDevice);
    syncMocks.fetchSyncPreview.mockResolvedValue(livePreview);
    const screen = await renderHomeScreen();

    expect(
      flattenStyle(
        hostByTestId(screen.root, "language-panel-header").props.style,
      ).flexDirection,
    ).toBe("column");
    expect(
      flattenStyle(hostByTestId(screen.root, "sync-metrics-grid").props.style)
        .flexDirection,
    ).toBe("column");
    expect(
      flattenStyle(hostByTestId(screen.root, "sync-device-row").props.style)
        .flexDirection,
    ).toBe("column");
    expect(
      flattenStyle(hostByTestId(screen.root, "language-option-en").props.style)
        .maxWidth,
    ).toBe(196);

    await pressPrimaryActionAndSettle(screen);

    expect(
      flattenStyle(
        hostByTestId(screen.root, "emergency-channel-relay").props.style,
      ).flexDirection,
    ).toBe("column");
    expect(
      hostByTestId(screen.root, "emergency-channel-relay").props
        .accessibilityLabel,
    ).toContain(
      "Route a short-lived terminal handoff through the last trusted desktop.",
    );
  });

  it("keeps large-text Arabic detail and emergency rows full-width", async () => {
    storageMocks.getItem.mockResolvedValueOnce("ar");
    setWindowDimensions({
      fontScale: 2,
      height: 844,
      width: 390,
    });
    syncMocks.registerDevice.mockResolvedValue(onlineDevice);
    syncMocks.fetchSyncPreview.mockResolvedValue(livePreview);
    const screen = await renderHomeScreen();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      flattenStyle(hostByTestId(screen.root, "sync-device-row").props.style)
        .alignItems,
    ).toBe("stretch");

    await pressPrimaryActionAndSettle(screen);

    expect(
      flattenStyle(
        hostByTestId(screen.root, "emergency-channel-relay").props.style,
      ).alignItems,
    ).toBe("stretch");
  });

  it("mirrors logical accents and tablet columns for Arabic", async () => {
    storageMocks.getItem.mockResolvedValueOnce("ar");
    setWindowDimensions({ fontScale: 1, height: 1024, width: 768 });
    const screen = await renderHomeScreen();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      flattenStyle(hostByTestId(screen.root, "sync-status-panel").props.style)
        .borderRightWidth,
    ).toBe(4);
    expect(
      flattenStyle(hostByTestId(screen.root, "sync-status-panel").props.style)
        .borderLeftWidth,
    ).toBe(1);
    expect(
      flattenStyle(hostByTestId(screen.root, "sync-detail-grid").props.style)
        .flexDirection,
    ).toBe("row-reverse");
    const languageGroup = screen.root.findAll(
      (node) =>
        node.props.accessibilityRole === "radiogroup" &&
        typeof node.type === "string",
    )[0];
    expect(
      flattenStyle(languageGroup.props.contentContainerStyle).flexDirection,
    ).toBe("row-reverse");
  });

  it("disables the action and shows registering state while device registration is pending", async () => {
    const pendingDevice = deferred<RegisteredDevice>();
    syncMocks.registerDevice.mockReturnValue(pendingDevice.promise);
    const screen = await renderHomeScreen();

    await startPrimaryAction(screen);

    expect(textContent(screen.root)).toContain("Registering device");
    expect(textContent(screen.root)).toContain("Preparing Preview");
    expect(
      hostByTestId(screen.root, "sync-primary-action").props.disabled,
    ).toBe(true);

    await act(async () => {
      pendingDevice.resolve(onlineDevice);
      await Promise.resolve();
    });
  });

  it("keeps the action disabled and announced while preview preparation is busy", async () => {
    const pendingPush = deferred<{
      accepted: number;
      conflicts: [];
      syncCursor: string;
    }>();
    syncMocks.registerDevice.mockResolvedValue(onlineDevice);
    syncMocks.pushMobilePresenceCheckpoint.mockReturnValue(pendingPush.promise);
    syncMocks.fetchSyncPreview.mockResolvedValue(livePreview);
    const screen = await renderHomeScreen();

    await startPrimaryAction(screen);
    await act(async () => {
      await Promise.resolve();
    });

    expect(hostByTestId(screen.root, "sync-status-previewing")).toBeTruthy();
    expect(
      hostByTestId(screen.root, "sync-status-panel").props.accessibilityState,
    ).toEqual({ busy: true });
    expect(
      hostByTestId(screen.root, "sync-primary-action").props.accessibilityState,
    ).toEqual({ busy: true, disabled: true });
    expect(
      hostByTestId(screen.root, "sync-primary-action").props.focusable,
    ).toBe(false);

    await act(async () => {
      pendingPush.resolve({
        accepted: 1,
        conflicts: [],
        syncCursor: "server-1",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("renders ready preview data and emergency channels after a successful pull", async () => {
    syncMocks.registerDevice.mockResolvedValue(onlineDevice);
    syncMocks.fetchSyncPreview.mockResolvedValue(livePreview);
    const screen = await renderHomeScreen();

    await pressPrimaryActionAndSettle(screen);

    expect(syncMocks.pushMobilePresenceCheckpoint).toHaveBeenCalledWith(
      onlineDevice,
    );
    expect(syncMocks.fetchSyncPreview).toHaveBeenCalledWith(
      "mobile-online",
      "0",
    );
    expect(
      syncMocks.pushMobilePresenceCheckpoint.mock.invocationCallOrder[0],
    ).toBeLessThan(syncMocks.fetchSyncPreview.mock.invocationCallOrder[0]);
    expect(textContent(screen.root)).toContain("Preview ready");
    expect(textContent(screen.root)).toContain("Atlas Phone");
    expect(textContent(screen.root)).toContain("online");
    expect(textContent(screen.root)).toContain("4");
    expect(textContent(screen.root)).toContain("2");
    expect(textContent(screen.root)).toContain("1");
    expect(textContent(screen.root)).toContain("C:\\Tools\\agenttool");
    expect(textContent(screen.root)).toContain("sync-api / npm run qa:mobile");
    expect(textContent(screen.root)).toContain("Relay Connect");
    expect(textContent(screen.root)).toContain("Cached Key");
    expect(hostByTestId(screen.root, "sync-status-ready")).toBeTruthy();
    expect(hostByTestId(screen.root, "sync-preview-workspace")).toBeTruthy();
    expect(hostByTestId(screen.root, "sync-preview-command")).toBeTruthy();
    expect(hostByTestId(screen.root, "emergency-channel-relay")).toBeTruthy();
    expect(
      hostByTestId(screen.root, "emergency-channel-local-cache"),
    ).toBeTruthy();
    expect(
      hostByTestId(screen.root, "sync-primary-action").props.disabled,
    ).toBe(false);
  });

  it("retains the last successful pull cursor for same-device refreshes", async () => {
    syncMocks.registerDevice.mockResolvedValue(onlineDevice);
    syncMocks.fetchSyncPreview
      .mockResolvedValueOnce({
        ...livePreview,
        cursor: {
          ...livePreview.cursor,
          lastCommand: "next cursor server-42",
        },
        syncCursor: "server-42",
      })
      .mockResolvedValueOnce({
        ...livePreview,
        cursor: {
          ...livePreview.cursor,
          lastCommand: "next cursor server-43",
        },
        syncCursor: "server-43",
      });
    const screen = await renderHomeScreen();

    await pressPrimaryActionAndSettle(screen);
    await pressPrimaryActionAndSettle(screen);

    expect(syncMocks.pushMobilePresenceCheckpoint).toHaveBeenNthCalledWith(
      1,
      onlineDevice,
    );
    expect(syncMocks.fetchSyncPreview).toHaveBeenNthCalledWith(
      1,
      "mobile-online",
      "0",
    );
    expect(syncMocks.pushMobilePresenceCheckpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "mobile-online",
        syncCursor: "server-42",
      }),
    );
    expect(syncMocks.fetchSyncPreview).toHaveBeenNthCalledWith(
      2,
      "mobile-online",
      "server-42",
    );
    expect(textContent(screen.root)).toContain(
      "sync-api / next cursor server-43",
    );
  });

  it("keeps the last successful cursor after a failed refresh retry", async () => {
    const timeoutError: SyncError = {
      code: "timeout",
      message: "The sync service did not answer in time.",
      recoverable: true,
      title: "Sync timed out",
    };
    syncMocks.registerDevice.mockResolvedValue(onlineDevice);
    syncMocks.asSyncError.mockReturnValue(timeoutError);
    syncMocks.fetchSyncPreview
      .mockResolvedValueOnce({
        ...livePreview,
        cursor: {
          ...livePreview.cursor,
          lastCommand: "next cursor server-42",
        },
        syncCursor: "server-42",
      })
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({
        ...livePreview,
        cursor: {
          ...livePreview.cursor,
          lastCommand: "next cursor server-43",
        },
        syncCursor: "server-43",
      });
    const screen = await renderHomeScreen();

    await pressPrimaryActionAndSettle(screen);
    await pressPrimaryActionAndSettle(screen);

    expect(textContent(screen.root)).toContain("Sync timed out");
    expect(syncMocks.fetchSyncPreview).toHaveBeenNthCalledWith(
      2,
      "mobile-online",
      "server-42",
    );

    await pressPrimaryActionAndSettle(screen);

    expect(syncMocks.pushMobilePresenceCheckpoint).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        id: "mobile-online",
        syncCursor: "server-42",
      }),
    );
    expect(syncMocks.fetchSyncPreview).toHaveBeenNthCalledWith(
      3,
      "mobile-online",
      "server-42",
    );
    expect(textContent(screen.root)).toContain(
      "sync-api / next cursor server-43",
    );
  });

  it("continues pulling the preview when a repeated presence push reports conflicts", async () => {
    syncMocks.registerDevice.mockResolvedValue(onlineDevice);
    syncMocks.pushMobilePresenceCheckpoint
      .mockResolvedValueOnce({
        accepted: 1,
        conflicts: [],
        syncCursor: "server-41",
      })
      .mockResolvedValueOnce({
        accepted: 0,
        conflicts: [
          {
            entity_id: "mobile-online",
            entity_type: "mobile_presence",
            reason: "changed_after_base_cursor",
          },
        ],
        syncCursor: "server-43",
      });
    syncMocks.fetchSyncPreview
      .mockResolvedValueOnce({
        ...livePreview,
        cursor: {
          ...livePreview.cursor,
          lastCommand: "next cursor server-42",
        },
        syncCursor: "server-42",
      })
      .mockResolvedValueOnce({
        ...livePreview,
        cursor: {
          ...livePreview.cursor,
          lastCommand: "next cursor server-44",
        },
        syncCursor: "server-44",
      });
    const screen = await renderHomeScreen();

    await pressPrimaryActionAndSettle(screen);
    await pressPrimaryActionAndSettle(screen);

    expect(syncMocks.pushMobilePresenceCheckpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "mobile-online",
        syncCursor: "server-42",
      }),
    );
    expect(syncMocks.fetchSyncPreview).toHaveBeenNthCalledWith(
      2,
      "mobile-online",
      "server-42",
    );
    expect(textContent(screen.root)).toContain("Preview ready");
    expect(textContent(screen.root)).toContain(
      "sync-api / next cursor server-44",
    );
    expect(hostNodesByTestId(screen.root, "sync-error-panel")).toHaveLength(0);
  });

  it("renders offline fallback warnings when the registered device is offline", async () => {
    const offlineError: SyncError = {
      code: "offline",
      message: "Cached context is available while the service is offline.",
      recoverable: true,
      title: "Sync service offline",
    };

    syncMocks.registerDevice.mockResolvedValue(offlineDevice);
    syncMocks.fetchSyncPreview.mockResolvedValue(livePreview);
    syncMocks.getOfflineError.mockReturnValue(offlineError);
    const screen = await renderHomeScreen();

    await pressPrimaryActionAndSettle(screen);

    expect(syncMocks.pushMobilePresenceCheckpoint).not.toHaveBeenCalled();
    expect(textContent(screen.root)).toContain("Offline fallback active");
    expect(textContent(screen.root)).toContain("Sync service offline");
    expect(textContent(screen.root)).toContain(
      "Cached context is available while the service is offline.",
    );
    expect(hostByTestId(screen.root, "sync-status-offline")).toBeTruthy();
    expect(
      hostByTestId(screen.root, "sync-error-offline-fallback"),
    ).toBeTruthy();
    expect(hostByTestId(screen.root, "sync-preview-workspace")).toBeTruthy();
    expect(hostByTestId(screen.root, "sync-preview-command")).toBeTruthy();
    expect(hostByTestId(screen.root, "emergency-channel-relay")).toBeTruthy();
    expect(
      hostByTestId(screen.root, "emergency-channel-local-cache"),
    ).toBeTruthy();
    expect(hostNodesByTestId(screen.root, "sync-error-panel")).toHaveLength(1);
  });

  it("renders structured sync errors from the preview flow", async () => {
    const unauthorized: SyncError = {
      code: "unauthorized",
      message: "Sign in again before pulling live workspace state.",
      recoverable: false,
      title: "Sign-in required",
    };

    syncMocks.registerDevice.mockRejectedValue(unauthorized);
    syncMocks.asSyncError.mockReturnValue(unauthorized);
    const screen = await renderHomeScreen();

    await pressPrimaryActionAndSettle(screen);

    expect(textContent(screen.root)).toContain("Sign-in required");
    expect(textContent(screen.root)).toContain(
      "Sign in again before pulling live workspace state.",
    );
    expect(
      hostByTestId(screen.root, "sync-status-error-unauthorized"),
    ).toBeTruthy();
    expect(hostNodesByTestId(screen.root, "sync-error-panel")).toHaveLength(1);
  });

  it.each([
    {
      code: "timeout" as const,
      errorBackground: "#fff7e8",
      message: "The sync service did not answer in time.",
      statusBorder: "#d8ad60",
      title: "Sync timed out",
    },
    {
      code: "unknown" as const,
      errorBackground: "#fff1f2",
      message: "The preview could not be refreshed.",
      statusBorder: "#e9aeb3",
      title: "Sync interrupted",
    },
  ])(
    "renders the $code error with the correct semantic tone",
    async ({ code, errorBackground, message, statusBorder, title }) => {
      const error: SyncError = {
        code,
        message,
        recoverable: true,
        title,
      };
      syncMocks.registerDevice.mockRejectedValue(error);
      syncMocks.asSyncError.mockReturnValue(error);
      const screen = await renderHomeScreen();

      await pressPrimaryActionAndSettle(screen);

      expect(
        hostByTestId(screen.root, `sync-status-error-${code}`),
      ).toBeTruthy();
      expect(
        flattenStyle(hostByTestId(screen.root, "sync-status-panel").props.style)
          .borderColor,
      ).toBe(statusBorder);
      const errorPanel = hostByTestId(screen.root, "sync-error-panel");
      expect(flattenStyle(errorPanel.props.style).backgroundColor).toBe(
        errorBackground,
      );
      expect(errorPanel.props.accessibilityLiveRegion).toBe("assertive");
      expect(errorPanel.props.accessibilityLabel).toBe(`${title}. ${message}`);
      expect(hostByTestId(screen.root, `sync-error-${code}`)).toBeTruthy();
    },
  );
});

const onlineDevice: RegisteredDevice = {
  connectionQuality: "online",
  id: "mobile-online",
  name: "Atlas Phone",
  platform: "ios",
  registeredAt: "2026-05-25T00:00:00Z",
  syncCursor: "0",
};

const offlineDevice: RegisteredDevice = {
  ...onlineDevice,
  connectionQuality: "offline",
  id: "mobile-offline",
};

const livePreview: SyncPreview = {
  cursor: {
    branch: "sync-api",
    lastCommand: "npm run qa:mobile",
    workspace: "C:\\Tools\\agenttool",
  },
  devices: [onlineDevice],
  emergencyChannels: [
    {
      availableOffline: false,
      detail:
        "Route a short-lived terminal handoff through the last trusted desktop.",
      id: "relay",
      label: "Relay Connect",
    },
    {
      availableOffline: true,
      detail:
        "Open cached profiles and recovery notes while the network is down.",
      id: "local-cache",
      label: "Cached Key",
    },
  ],
  generatedAt: "2026-05-25T00:00:00Z",
  openSessionCount: 2,
  pendingChangeCount: 1,
  profileCount: 4,
};

async function renderHomeScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <MobileLocaleProvider>
        <HomeScreen />
      </MobileLocaleProvider>,
    );
    await Promise.resolve();
  });
  return renderer;
}

async function startPrimaryAction(screen: TestRenderer.ReactTestRenderer) {
  await act(async () => {
    void hostByTestId(screen.root, "sync-primary-action").props.onPress();
    await Promise.resolve();
  });
}

async function pressPrimaryActionAndSettle(
  screen: TestRenderer.ReactTestRenderer,
) {
  await act(async () => {
    await hostByTestId(screen.root, "sync-primary-action").props.onPress();
    await Promise.resolve();
  });
}

function textContent(instance: ReactTestInstance): string {
  return instance
    .findAll((node) => typeof node.children?.[0] === "string")
    .map((node) => node.children.join(""))
    .join("\n");
}

function hostByTestId(instance: ReactTestInstance, testID: string) {
  const nodes = hostNodesByTestId(instance, testID);

  if (nodes.length !== 1) {
    throw new Error(
      `Expected exactly one host node with testID ${testID}, found ${nodes.length}.`,
    );
  }

  return nodes[0];
}

function hostNodesByTestId(instance: ReactTestInstance, testID: string) {
  return instance.findAll(
    (node) => node.props.testID === testID && typeof node.type === "string",
  );
}

function textByContent(instance: ReactTestInstance, text: string) {
  const nodes = instance.findAll(
    (node) => node.children.join("") === text && typeof node.type === "string",
  );

  if (nodes.length !== 1) {
    throw new Error(
      `Expected exactly one text node with content ${text}, found ${nodes.length}.`,
    );
  }

  return nodes[0];
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) {
    return {};
  }

  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (flattened, item) => ({ ...flattened, ...flattenStyle(item) }),
      {},
    );
  }

  if (typeof style === "object") {
    return style as Record<string, unknown>;
  }

  return {};
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}
