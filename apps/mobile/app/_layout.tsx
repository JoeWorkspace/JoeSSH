import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Component, type PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { createTranslator, detectAtlasLocale, loadLocale } from '@atlasterm/i18n';
import { createErrorMonitor, isTelemetryOptedIn } from '@atlasterm/error-monitor';

import { getMobileLocaleCandidates } from '@/services/locale';

// Install error monitoring; gracefully handles missing browser APIs in RN.
const mobileEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

if (isTelemetryOptedIn(mobileEnv.EXPO_PUBLIC_ATLASTERM_TELEMETRY_OPT_IN)) {
  try {
    createErrorMonitor({
      app: 'mobile',
      endpoint: mobileEnv.EXPO_PUBLIC_ATLASTERM_ERROR_MONITOR_ENDPOINT,
      version: mobileEnv.EXPO_PUBLIC_ATLASTERM_APP_VERSION ?? '0.1.0-beta.6',
    }).install();
  } catch {
    // The browser-oriented monitor can be unavailable in native runtimes.
  }
}

interface ErrorBoundaryProps {
  messageLabel?: string;
  reloadLabel?: string;
  titleLabel?: string;
}

interface ErrorBoundaryState {
  error: Error | undefined;
}

class ErrorBoundary extends Component<PropsWithChildren & ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.errorContainer} accessible role="alert">
          <Text style={styles.errorTitle}>{this.props.titleLabel ?? 'Something went wrong'}</Text>
          <Text style={styles.errorMessage}>
            {this.props.messageLabel ?? 'Reload JoeSSH or contact support if the issue continues.'}
          </Text>
          <Pressable
            style={styles.reloadButton}
            onPress={() => {
              this.setState({ error: undefined });
            }}
            accessibilityLabel={this.props.reloadLabel ?? 'Reload'}
          >
            <Text style={styles.reloadText}>{this.props.reloadLabel ?? 'Reload'}</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

function RootLayoutWithBoundary() {
  const locale = useMemo(() => detectAtlasLocale(getMobileLocaleCandidates()), []);
  const [t, setT] = useState(() => createTranslator(locale));

  useEffect(() => {
    let cancelled = false;
    loadLocale(locale).then((translator) => {
      if (!cancelled) setT(() => translator);
    });
    return () => { cancelled = true; };
  }, [locale]);

  return (
    <ErrorBoundary
      messageLabel={t('mobile.error.boundary.message')}
      titleLabel={t('mobile.error.boundary.title')}
      reloadLabel={t('mobile.error.boundary.reload')}
    >
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#101820' },
          headerTintColor: '#f4f7fb',
          contentStyle: { backgroundColor: '#f4f7fb' },
        }}
      />
      <StatusBar style="light" />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f4f7fb',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#101820',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    color: '#526070',
    marginBottom: 20,
    textAlign: 'center',
  },
  reloadButton: {
    backgroundColor: '#3467eb',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  reloadText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default function RootLayout() {
  return <RootLayoutWithBoundary />;
}
