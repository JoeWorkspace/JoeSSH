import React from "react";

function makeHost(name: string) {
  return ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    style?: unknown;
    testID?: string;
    accessible?: boolean;
    accessibilityLabel?: string;
    accessibilityElementsHidden?: boolean;
    [key: string]: unknown;
  }) => React.createElement(name, props, children);
}

type ColorScheme = "light" | "dark" | null;
type WindowDimensions = {
  fontScale: number;
  height: number;
  scale: number;
  width: number;
};

let colorScheme: ColorScheme = "light";
let windowDimensions: WindowDimensions = {
  fontScale: 1,
  height: 700,
  scale: 2,
  width: 320,
};

export function setColorScheme(nextColorScheme: ColorScheme) {
  colorScheme = nextColorScheme;
}

export function useColorScheme() {
  return colorScheme;
}

export function setWindowDimensions(nextDimensions: Partial<WindowDimensions>) {
  windowDimensions = { ...windowDimensions, ...nextDimensions };
}

export function useWindowDimensions() {
  return windowDimensions;
}

export const ActivityIndicator = makeHost("ActivityIndicator");
export const Pressable = makeHost("Pressable");
export const SafeAreaProvider = makeHost("SafeAreaProvider");
export const SafeAreaView = makeHost("SafeAreaView");
export const ScrollView = makeHost("ScrollView");
export const Text = makeHost("Text");
export const View = makeHost("View");

export const NativeModules = {
  I18nManager: {
    getConstants: () => ({ localeIdentifier: "en-US", locale: "en-US" }),
  },
  SettingsManager: {
    settings: {
      AppleLanguages: ["en-US"],
      AppleLocale: "en-US",
    },
  },
};

export const Platform = { OS: "ios" };

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T) => styles,
  flatten: (style: unknown) => flattenStyle(style),
};

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
