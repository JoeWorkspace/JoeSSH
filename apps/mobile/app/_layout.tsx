import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Component, type PropsWithChildren } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import {
  createErrorMonitor,
  isTelemetryOptedIn,
} from "@atlasterm/error-monitor";

import {
  MobileLocaleProvider,
  useMobileLocale,
} from "@/services/localeContext";
import { getMobileTheme } from "@/theme";
import type { MobileTheme } from "@/theme";

// Install error monitoring; gracefully handles missing browser APIs in RN.
const mobileEnv =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

if (isTelemetryOptedIn(mobileEnv.EXPO_PUBLIC_ATLASTERM_TELEMETRY_OPT_IN)) {
  try {
    createErrorMonitor({
      app: "mobile",
      endpoint: mobileEnv.EXPO_PUBLIC_ATLASTERM_ERROR_MONITOR_ENDPOINT,
      version: mobileEnv.EXPO_PUBLIC_ATLASTERM_APP_VERSION ?? "0.1.0-beta.23",
    }).install();
  } catch {
    // The browser-oriented monitor can be unavailable in native runtimes.
  }
}

interface ErrorBoundaryProps {
  isRtl: boolean;
  messageLabel?: string;
  reloadLabel?: string;
  theme: MobileTheme;
  titleLabel?: string;
}

interface ErrorBoundaryState {
  error: Error | undefined;
}

export class ErrorBoundary extends Component<
  PropsWithChildren & ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      const { isRtl, theme } = this.props;
      const titleLabel = this.props.titleLabel ?? "Something went wrong";
      const messageLabel =
        this.props.messageLabel ??
        "Reload JoeSSH or contact support if the issue continues.";

      return (
        <SafeAreaView
          style={{
            backgroundColor: theme.screenBackground,
            flex: 1,
          }}
          testID="fatal-error-screen"
        >
          <ScrollView
            contentContainerStyle={styles.errorContainer}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.errorCard,
                {
                  backgroundColor: theme.panelBackground,
                  borderColor: theme.panelBorder,
                  boxShadow: theme.dialogShadow,
                },
              ]}
            >
              <View
                style={[
                  styles.brandLockup,
                  isRtl ? styles.rtlRow : null,
                  isRtl ? styles.brandLockupRtl : null,
                ]}
                testID="fatal-brand-lockup"
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={[
                    styles.brandMark,
                    {
                      backgroundColor: theme.accentSoft,
                      borderColor: theme.accent,
                    },
                  ]}
                >
                  <Text style={[styles.brandMarkText, { color: theme.accent }]}>
                    {">_"}
                  </Text>
                </View>
                <Text style={[styles.brandName, { color: theme.accentText }]}>
                  JoeSSH
                </Text>
              </View>

              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[
                  styles.errorIcon,
                  {
                    backgroundColor: theme.errorBackground,
                    borderColor: theme.errorBorder,
                  },
                ]}
              >
                <Text style={[styles.errorIconText, { color: theme.red }]}>
                  !
                </Text>
              </View>

              <View
                accessible
                accessibilityLabel={`${titleLabel}. ${messageLabel}`}
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={styles.errorCopy}
                testID="fatal-error-alert"
              >
                <Text
                  accessibilityRole="header"
                  style={[styles.errorTitle, { color: theme.text }]}
                >
                  {titleLabel}
                </Text>
                <Text style={[styles.errorMessage, { color: theme.mutedText }]}>
                  {messageLabel}
                </Text>
              </View>

              <Pressable
                style={({ pressed }: { pressed: boolean }) => [
                  styles.reloadButton,
                  {
                    backgroundColor: pressed
                      ? theme.primaryButtonPressed
                      : theme.primaryButtonBackground,
                    borderColor: theme.primaryButtonPressed,
                    boxShadow: theme.actionShadow,
                  },
                  pressed ? styles.reloadButtonPressed : null,
                ]}
                onPress={() => {
                  this.setState({ error: undefined });
                }}
                accessibilityLabel={this.props.reloadLabel ?? "Reload"}
                accessibilityRole="button"
                focusable
                testID="fatal-reload-action"
              >
                <Text
                  style={[
                    styles.reloadText,
                    { color: theme.primaryButtonText },
                  ]}
                >
                  {this.props.reloadLabel ?? "Reload"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

function RootLayoutWithBoundary() {
  const { localeState, t } = useMobileLocale();
  const colorScheme = useColorScheme();
  const theme = getMobileTheme(colorScheme);

  return (
    <SafeAreaProvider
      style={{ backgroundColor: theme.screenBackground, flex: 1 }}
    >
      <ErrorBoundary
        isRtl={localeState.direction === "rtl"}
        messageLabel={t("mobile.error.boundary.message")}
        titleLabel={t("mobile.error.boundary.title")}
        reloadLabel={t("mobile.error.boundary.reload")}
        theme={theme}
      >
        <Stack
          screenOptions={{
            animation: "fade",
            contentStyle: { backgroundColor: theme.screenBackground },
            headerShown: false,
          }}
        />
      </ErrorBoundary>
      <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  errorCard: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    gap: 22,
    maxWidth: 520,
    overflow: "hidden",
    padding: 24,
    width: "100%",
  },
  brandLockup: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 11,
  },
  brandLockupRtl: {
    alignSelf: "flex-end",
  },
  brandMark: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  brandMarkText: {
    fontFamily: "monospace",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -1,
  },
  brandName: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  errorIcon: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  errorIconText: {
    fontFamily: "monospace",
    fontSize: 28,
    fontWeight: "800",
  },
  errorCopy: {
    alignItems: "center",
    gap: 8,
    maxWidth: 420,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 30,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
  reloadButton: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 12,
    width: "100%",
  },
  reloadButtonPressed: {
    transform: [{ scale: 0.985 }, { translateY: 1 }],
  },
  reloadText: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "800",
    minWidth: 0,
    textAlign: "center",
  },
  rtlRow: {
    flexDirection: "row-reverse",
  },
});

export default function RootLayout() {
  return (
    <MobileLocaleProvider>
      <RootLayoutWithBoundary />
    </MobileLocaleProvider>
  );
}
