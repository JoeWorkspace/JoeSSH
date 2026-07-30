import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { Pressable, Text, View } from "react-native";

import { loadLocale } from "@atlasterm/i18n";

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
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

import {
  MobileLocaleProvider,
  useMobileLocale,
} from "../services/localeContext";

describe("mobile locale provider", () => {
  beforeAll(async () => {
    await Promise.all([loadLocale("en"), loadLocale("ar")]);
  });

  beforeEach(() => {
    storageMocks.getItem.mockReset();
    storageMocks.setItem.mockReset();
    storageMocks.getItem.mockResolvedValue(null);
    storageMocks.setItem.mockResolvedValue(undefined);
  });

  it("shares a locale change across root and route consumers", async () => {
    let screen!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      screen = TestRenderer.create(
        <MobileLocaleProvider>
          <LocaleConsumer testID="root-locale-consumer" />
          <LocaleConsumer canChange testID="route-locale-consumer" />
        </MobileLocaleProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      textByTestId(screen.root, "root-locale-value").children.join(""),
    ).toBe("en:ltr");
    expect(
      textByTestId(screen.root, "route-locale-value").children.join(""),
    ).toBe("en:ltr");

    await act(async () => {
      hostByTestId(screen.root, "route-locale-consumer").props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      textByTestId(screen.root, "root-locale-value").children.join(""),
    ).toBe("ar:rtl");
    expect(
      textByTestId(screen.root, "route-locale-value").children.join(""),
    ).toBe("ar:rtl");
    expect(storageMocks.setItem).toHaveBeenCalledWith(
      "atlasterm.mobile.language",
      "ar",
    );

    await act(async () => {
      screen.unmount();
    });
  });

  it("restores one persisted locale for every consumer", async () => {
    storageMocks.getItem.mockResolvedValueOnce("ar");
    let screen!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      screen = TestRenderer.create(
        <MobileLocaleProvider>
          <LocaleConsumer testID="root-locale-consumer" />
          <LocaleConsumer testID="route-locale-consumer" />
        </MobileLocaleProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(storageMocks.getItem).toHaveBeenCalledTimes(1);
    expect(
      textByTestId(screen.root, "root-locale-value").children.join(""),
    ).toBe("ar:rtl");
    expect(
      textByTestId(screen.root, "route-locale-value").children.join(""),
    ).toBe("ar:rtl");

    await act(async () => {
      screen.unmount();
    });
  });

  it("does not let a late storage restore overwrite a newer user choice", async () => {
    const pendingStoredMode = deferred<string | null>();
    storageMocks.getItem.mockReturnValueOnce(pendingStoredMode.promise);
    let screen!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      screen = TestRenderer.create(
        <MobileLocaleProvider>
          <LocaleConsumer canChange testID="route-locale-consumer" />
        </MobileLocaleProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      hostByTestId(screen.root, "route-locale-consumer").props.onPress();
      await Promise.resolve();
      pendingStoredMode.resolve("en");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      textByTestId(screen.root, "route-locale-value").children.join(""),
    ).toBe("ar:rtl");
    expect(storageMocks.setItem).toHaveBeenCalledWith(
      "atlasterm.mobile.language",
      "ar",
    );

    await act(async () => {
      screen.unmount();
    });
  });

  it("serializes rapid locale writes so the latest choice wins in storage", async () => {
    const firstWrite = deferred<void>();
    storageMocks.setItem
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    let screen!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      screen = TestRenderer.create(
        <MobileLocaleProvider>
          <LocaleConsumer
            canChange
            nextLocale="ar"
            testID="arabic-locale-consumer"
          />
          <LocaleConsumer
            canChange
            nextLocale="en"
            testID="english-locale-consumer"
          />
        </MobileLocaleProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      hostByTestId(screen.root, "arabic-locale-consumer").props.onPress();
      hostByTestId(screen.root, "english-locale-consumer").props.onPress();
      await Promise.resolve();
    });

    expect(storageMocks.setItem).toHaveBeenCalledTimes(1);
    expect(storageMocks.setItem).toHaveBeenNthCalledWith(
      1,
      "atlasterm.mobile.language",
      "ar",
    );

    await act(async () => {
      firstWrite.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(storageMocks.setItem).toHaveBeenNthCalledWith(
      2,
      "atlasterm.mobile.language",
      "en",
    );
    expect(
      textByTestId(screen.root, "english-locale-value").children.join(""),
    ).toBe("en:ltr");

    await act(async () => {
      screen.unmount();
    });
  });
});

function LocaleConsumer({
  canChange = false,
  nextLocale = "ar",
  testID,
}: {
  canChange?: boolean;
  nextLocale?: "ar" | "en";
  testID: string;
}) {
  const { localeState, setLocaleMode } = useMobileLocale();

  return (
    <Pressable
      disabled={!canChange}
      onPress={() => setLocaleMode(nextLocale)}
      testID={testID}
    >
      <View>
        <Text testID={testID.replace("consumer", "value")}>
          {localeState.locale}:{localeState.direction}
        </Text>
      </View>
    </Pressable>
  );
}
function hostByTestId(instance: ReactTestInstance, testID: string) {
  return instance.find(
    (node) => node.props.testID === testID && typeof node.type === "string",
  );
}

function textByTestId(instance: ReactTestInstance, testID: string) {
  return instance.find(
    (node) => node.props.testID === testID && typeof node.type === "string",
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}
