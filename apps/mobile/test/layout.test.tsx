import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";

vi.mock("expo-router", () => ({
  Stack: "Stack",
}));

vi.mock("expo-status-bar", () => ({
  StatusBar: "StatusBar",
}));

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("@atlasterm/error-monitor", () => ({
  createErrorMonitor: () => ({ install: vi.fn() }),
  isTelemetryOptedIn: () => false,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: storageMocks,
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

import { setColorScheme } from "./reactNativeMock";
import RootLayout, { ErrorBoundary } from "../app/_layout";
import { getMobileTheme } from "../theme";

describe("mobile fatal error surface", () => {
  beforeEach(() => {
    setColorScheme("light");
    storageMocks.getItem.mockReset();
    storageMocks.setItem.mockReset();
    storageMocks.getItem.mockResolvedValue(null);
    storageMocks.setItem.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the alert, reload action, dark theme, RTL, and scrollable large-text shell accessible", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let screen!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      screen = TestRenderer.create(
        <ErrorBoundary
          isRtl
          messageLabel="تعذر متابعة تشغيل JoeSSH."
          reloadLabel="إعادة التحميل"
          theme={getMobileTheme("dark")}
          titleLabel="حدث خطأ ما"
        >
          <ThrowingChild />
        </ErrorBoundary>,
      );
    });

    const fatalScreen = hostByTestId(screen.root, "fatal-error-screen");
    const alert = hostByTestId(screen.root, "fatal-error-alert");
    const reloadAction = hostByTestId(screen.root, "fatal-reload-action");
    const reloadStyle = reloadAction.props.style({ pressed: false });
    const scrollView = screen.root.findAll(
      (node) =>
        node.props.showsVerticalScrollIndicator === false &&
        node.props.contentContainerStyle,
    )[0];

    expect(fatalScreen.props.style).toEqual({
      backgroundColor: "#080d12",
      flex: 1,
    });
    expect(alert.props.accessible).toBe(true);
    expect(alert.props.accessibilityRole).toBe("alert");
    expect(alert.props.accessibilityLiveRegion).toBe("assertive");
    expect(alert.props.accessibilityLabel).toContain("حدث خطأ ما");
    expect(reloadAction.props.accessibilityRole).toBe("button");
    expect(reloadAction.props.focusable).toBe(true);
    expect(flattenStyle(reloadStyle).minHeight).toBe(54);
    expect(
      flattenStyle(hostByTestId(screen.root, "fatal-brand-lockup").props.style)
        .flexDirection,
    ).toBe("row-reverse");
    expect(flattenStyle(scrollView.props.contentContainerStyle).flexGrow).toBe(
      1,
    );
    expect(
      flattenStyle(scrollView.props.contentContainerStyle).flex,
    ).toBeUndefined();

    await act(async () => {
      screen.unmount();
    });
  });

  it("restores the persisted RTL locale while keeping the themed status bar outside the boundary", async () => {
    setColorScheme("dark");
    storageMocks.getItem.mockResolvedValueOnce("ar");
    let screen!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      screen = TestRenderer.create(<RootLayout />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const boundary = screen.root.findByType(ErrorBoundary);
    const statusBars = screen.root.findAll(
      (node) => node.props.style === "light" && typeof node.type === "string",
    );
    const nestedStatusBars = boundary.findAll(
      (node) => node.props.style === "light" && typeof node.type === "string",
    );

    expect(storageMocks.getItem).toHaveBeenCalledWith(
      "atlasterm.mobile.language",
    );
    expect(boundary.props.isRtl).toBe(true);
    expect(statusBars).toHaveLength(1);
    expect(nestedStatusBars).toHaveLength(0);

    await act(async () => {
      screen.unmount();
    });
  });
});

function ThrowingChild(): React.ReactNode {
  throw new Error("fatal render");
}

function hostByTestId(instance: ReactTestInstance, testID: string) {
  const nodes = instance.findAll(
    (node) => node.props.testID === testID && typeof node.type === "string",
  );

  if (nodes.length !== 1) {
    throw new Error(
      `Expected exactly one host node with testID ${testID}, found ${nodes.length}.`,
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

  return typeof style === "object" ? (style as Record<string, unknown>) : {};
}
