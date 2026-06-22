import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { createLocaleFormatters, createTranslator, loadLocale, SUPPORTED_LOCALES } from '@atlasterm/i18n';
import type { AtlasLocale } from '@atlasterm/i18n';

import type { EmergencyChannel, SyncDashboardState } from '@/models/sync';
import { getStoredMobileLocaleMode, persistMobileLocaleMode, resolveMobileLocale } from '@/services/locale';
import type { LocaleMode } from '@/services/locale';
import { asSyncError, fetchSyncPreview, getOfflineError, pushMobilePresenceCheckpoint, registerDevice } from '@/services/sync';

const initialState: SyncDashboardState = {
  phase: 'idle',
};

const languageOptionTestIds = {
  auto: 'language-option-auto',
  en: 'language-option-en',
} as const;

const syncErrorTestIds = {
  offline: 'sync-error-offline-fallback',
  timeout: 'sync-error-timeout',
  unauthorized: 'sync-error-unauthorized',
  unknown: 'sync-error-unknown',
} as const;

const mobileThemes = {
  light: {
    accentText: '#3467eb',
    commandBackground: '#101820',
    commandText: '#ffffff',
    commandMutedText: '#9fb1c5',
    errorBackground: '#fff7ed',
    errorBorder: '#fed7aa',
    errorText: '#7c2d12',
    errorTitle: '#9a3412',
    liveBadgeBackground: '#e0f2fe',
    liveBadgeText: '#075985',
    localeBadgeBackground: '#dbeafe',
    localeBadgeText: '#1d4ed8',
    mutedText: '#526070',
    offlineBadgeBackground: '#dcfce7',
    offlineBadgeText: '#166534',
    panelBackground: '#ffffff',
    panelBorder: '#d8e0ec',
    primaryButtonBackground: '#101820',
    primaryButtonText: '#ffffff',
    rowBorder: '#e2e8f0',
    screenBackground: '#eef3f8',
    selectedOptionBackground: '#101820',
    selectedOptionBorder: '#101820',
    selectedOptionMutedText: '#cbd5e1',
    selectedOptionText: '#ffffff',
    statusBusy: '#3467eb',
    statusIdle: '#6b5b00',
    statusReady: '#167c51',
    statusWarning: '#b45309',
    statusWarningBorder: '#f1b86b',
    text: '#101820',
  },
  dark: {
    accentText: '#8bb8ff',
    commandBackground: '#090d12',
    commandText: '#f8fafc',
    commandMutedText: '#a7b4c2',
    errorBackground: '#3a2114',
    errorBorder: '#a86128',
    errorText: '#fdba74',
    errorTitle: '#fed7aa',
    liveBadgeBackground: '#123344',
    liveBadgeText: '#7dd3fc',
    localeBadgeBackground: '#14345f',
    localeBadgeText: '#bfdbfe',
    mutedText: '#b8c2cc',
    offlineBadgeBackground: '#153422',
    offlineBadgeText: '#86efac',
    panelBackground: '#191f26',
    panelBorder: '#344052',
    primaryButtonBackground: '#e8eef7',
    primaryButtonText: '#111418',
    rowBorder: '#334155',
    screenBackground: '#111418',
    selectedOptionBackground: '#e8eef7',
    selectedOptionBorder: '#e8eef7',
    selectedOptionMutedText: '#465260',
    selectedOptionText: '#0d1117',
    statusBusy: '#93c5fd',
    statusIdle: '#facc15',
    statusReady: '#6ee7b7',
    statusWarning: '#fbbf24',
    statusWarningBorder: '#b7791f',
    text: '#f6f8fb',
  },
} as const;

type MobileTheme = (typeof mobileThemes)[keyof typeof mobileThemes];

export default function HomeScreen() {
  const [syncState, setSyncState] = useState<SyncDashboardState>(initialState);
  const [localeMode, setLocaleMode] = useState<LocaleMode>('auto');
  const colorScheme = useColorScheme();
  const theme = mobileThemes[colorScheme === 'dark' ? 'dark' : 'light'];

  const localeState = useMemo(() => resolveMobileLocale(localeMode), [localeMode]);
  const [t, setT] = useState(() => createTranslator(localeState.locale));
  const formatters = useMemo(() => createLocaleFormatters(localeState.locale), [localeState.locale]);
  const status = useMemo(() => getStatus(syncState, t, theme), [syncState, t, theme]);

  useEffect(() => {
    let cancelled = false;
    getStoredMobileLocaleMode().then((storedMode) => {
      if (!cancelled) {
        setLocaleMode(storedMode);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLocale(localeState.locale).then((translator) => {
      if (!cancelled) setT(() => translator);
    });
    return () => { cancelled = true; };
  }, [localeState.locale]);

  function handleLocaleModeChange(mode: LocaleMode) {
    setLocaleMode(mode);
    void persistMobileLocaleMode(mode);
  }

  const isBusy = syncState.phase === 'registering' || syncState.phase === 'previewing';
  const preview = syncState.preview;
  const emergencyChannels = preview?.emergencyChannels ?? [];

  async function runSyncPreview() {
    const lastKnownDevice = syncState.device;
    const lastKnownPreview = syncState.preview;
    let activeDevice = lastKnownDevice;
    setSyncState({ phase: 'registering' });

    try {
      const registeredDevice = await registerDevice();
      const retainedCursor = lastKnownDevice?.id === registeredDevice.id ? lastKnownDevice.syncCursor : undefined;
      const device = retainedCursor ? { ...registeredDevice, syncCursor: retainedCursor } : registeredDevice;
      activeDevice = device;
      setSyncState({ device, phase: 'previewing' });

      if (device.connectionQuality !== 'offline') {
        await pushMobilePresenceCheckpoint(device);
      }

      const nextPreview = await fetchSyncPreview(device.id, device.syncCursor ?? '0');
      const offlineError = device.connectionQuality === 'offline' ? getOfflineError() : undefined;
      const syncedDevice = nextPreview.syncCursor ? { ...device, syncCursor: nextPreview.syncCursor } : device;

      setSyncState({
        device: syncedDevice,
        error: offlineError,
        phase: offlineError ? 'offline' : 'ready',
        preview: nextPreview,
      });
    } catch (error) {
      setSyncState({
        device: activeDevice,
        error: asSyncError(error),
        phase: 'error',
        preview: lastKnownPreview,
      });
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.screenBackground }]} testID="mobile-home-root">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.header, localeState.direction === 'rtl' ? styles.rtlBlock : null]}>
          <View style={styles.headerTopline}>
            <Text style={[styles.kicker, { color: theme.accentText }, localeState.direction === 'rtl' ? styles.rtlText : null]}>{t('mobile.kicker')}</Text>
            <Text style={[styles.localeBadge, { backgroundColor: theme.localeBadgeBackground, color: theme.localeBadgeText }]}>{localeState.meta.nativeName}</Text>
          </View>
          <Text style={[styles.title, { color: theme.text }, localeState.direction === 'rtl' ? styles.rtlText : null]}>{t('mobile.title')}</Text>
          <Text style={[styles.subtitle, { color: theme.mutedText }, localeState.direction === 'rtl' ? styles.rtlText : null]}>{t('mobile.subtitle')}</Text>
        </View>

        <View style={[styles.languagePanel, { backgroundColor: theme.panelBackground, borderColor: theme.panelBorder }]} testID="language-panel">
          <View style={styles.languageHeader}>
            <Text style={[styles.languageTitle, { color: theme.text }]}>{t('language.selectorLabel')}</Text>
            <Text style={[styles.languageHint, { color: theme.mutedText }, localeState.direction === 'rtl' ? { textAlign: 'left' } : null]}>{t('language.worldReady')}</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.languageScroller}
            contentContainerStyle={styles.languageOptions}
          >
            <LanguageOption
              active={localeMode === 'auto'}
              label={t('language.autoRegion')}
              sublabel={localeState.autoLocale}
              testID={languageOptionTestIds.auto}
              theme={theme}
              onPress={() => handleLocaleModeChange('auto')}
            />
            {SUPPORTED_LOCALES.map((locale) => (
              <LanguageOption
                active={localeMode === locale.code}
                key={locale.code}
                label={locale.nativeName}
                sublabel={locale.code}
                testID={locale.code === 'en' ? languageOptionTestIds.en : `language-option-${locale.code}`}
                theme={theme}
                onPress={() => handleLocaleModeChange(locale.code)}
              />
            ))}
          </ScrollView>
        </View>

        <View
          accessibilityLabel={status.label}
          accessibilityRole="summary"
          accessibilityLiveRegion="polite"
          style={[
            styles.statusPanel,
            { backgroundColor: theme.panelBackground, borderColor: theme.panelBorder },
            syncState.error ? { borderColor: theme.statusWarningBorder } : null,
          ]}
          testID="sync-status-panel"
        >
          <IconMark label={status.icon} color={status.color} />
          <View style={[styles.statusCopy, localeState.direction === 'rtl' ? styles.rtlBlock : null]}>
            <Text style={[styles.statusLabel, { color: theme.text }, localeState.direction === 'rtl' ? styles.rtlText : null]} testID={status.testID}>
              {status.label}
            </Text>
            <Text style={[styles.statusText, { color: theme.mutedText }, localeState.direction === 'rtl' ? styles.rtlText : null]}>{status.message}</Text>
          </View>
          {isBusy ? <ActivityIndicator color={status.color} /> : null}
        </View>

        {syncState.error ? (
          <View
            accessibilityRole="alert"
            style={[styles.errorPanel, { backgroundColor: theme.errorBackground, borderColor: theme.errorBorder }]}
            testID="sync-error-panel"
          >
            <Text style={[styles.errorTitle, { color: theme.errorTitle }]} testID={syncErrorTestIds[syncState.error.code]}>
              {syncState.error.title}
            </Text>
            <Text style={[styles.errorText, { color: theme.errorText }]}>{syncState.error.message}</Text>
          </View>
        ) : null}

        <View style={styles.grid}>
          <InfoTile label={t('mobile.profiles')} value={formatters.number(preview?.profileCount ?? 0)} theme={theme} />
          <InfoTile label={t('mobile.openSessions')} value={formatters.number(preview?.openSessionCount ?? 0)} theme={theme} />
          <InfoTile label={t('mobile.pendingChanges')} value={formatters.number(preview?.pendingChangeCount ?? 0)} theme={theme} />
        </View>

        <View style={[styles.section, { backgroundColor: theme.panelBackground, borderColor: theme.panelBorder }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('mobile.deviceRegistration')}</Text>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: theme.mutedText }]}>{t('mobile.device')}</Text>
            <Text style={[styles.detailValue, { color: theme.text }, localeState.direction === 'rtl' ? { textAlign: 'left' } : null]}>{syncState.device?.name ?? t('mobile.notRegistered')}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: theme.mutedText }]}>{t('mobile.quality')}</Text>
            <Text style={[styles.detailValue, { color: theme.text }, localeState.direction === 'rtl' ? { textAlign: 'left' } : null]} testID="sync-device-quality">
              {formatConnectionQuality(syncState, t)}
            </Text>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: theme.panelBackground, borderColor: theme.panelBorder }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('mobile.pullPreview')}</Text>
          <View style={[styles.commandPreview, { backgroundColor: theme.commandBackground }]}>
            <Text style={[styles.commandWorkspace, { color: theme.commandMutedText }]} testID="sync-preview-workspace">
              {preview?.cursor.workspace ?? t('mobile.noWorkspace')}
            </Text>
            <Text style={[styles.commandText, { color: theme.commandText }]} testID="sync-preview-command">
              {preview ? `${preview.cursor.branch} / ${preview.cursor.lastCommand}` : t('mobile.runPreview')}
            </Text>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: theme.panelBackground, borderColor: theme.panelBorder }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('mobile.emergencyConnection')}</Text>
          {emergencyChannels.length > 0 ? (
            emergencyChannels.map((channel) => (
              <EmergencyChannelRow key={channel.id} channel={channel} liveLabel={t('mobile.liveBadge')} offlineLabel={t('mobile.offlineBadge')} theme={theme} />
            ))
          ) : (
            <Text style={[styles.emptyText, { color: theme.mutedText }]}>{t('mobile.emptyRoutes')}</Text>
          )}
        </View>

        <Pressable
          style={[styles.primaryButton, { backgroundColor: theme.primaryButtonBackground }, isBusy ? styles.primaryButtonDisabled : null]}
          onPress={runSyncPreview}
          accessibilityLabel={isBusy ? t('mobile.preparing') : t('mobile.registerPull')}
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy, busy: isBusy }}
          disabled={isBusy}
          testID="sync-primary-action"
        >
          <IconMark label={isBusy ? '...' : 'GO'} color={theme.primaryButtonText} compact />
          <Text style={[styles.primaryButtonText, { color: theme.primaryButtonText }]}>{isBusy ? t('mobile.preparing') : t('mobile.registerPull')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function getStatus(state: SyncDashboardState, t: ReturnType<typeof createTranslator>, theme: MobileTheme) {
  if (state.phase === 'registering') {
    return {
      color: theme.statusBusy,
      icon: 'ID',
      label: t('mobile.registering'),
      message: t('mobile.registeringMessage'),
      testID: 'sync-status-registering',
    };
  }

  if (state.phase === 'previewing') {
    return {
      color: theme.statusBusy,
      icon: 'SY',
      label: t('mobile.previewing'),
      message: t('mobile.previewingMessage'),
      testID: 'sync-status-previewing',
    };
  }

  if (state.phase === 'ready') {
    return {
      color: theme.statusReady,
      icon: 'OK',
      label: t('mobile.ready'),
      message: t('mobile.readyMessage'),
      testID: 'sync-status-ready',
    };
  }

  if (state.phase === 'offline' || state.phase === 'error') {
    return {
      color: theme.statusWarning,
      icon: 'OF',
      label: t('mobile.offline'),
      message: t('mobile.offlineMessage'),
      testID: 'sync-status-offline',
    };
  }

  return {
    color: theme.statusIdle,
    icon: 'RD',
    label: t('mobile.readyToConnect'),
    message: t('mobile.readyToConnectMessage'),
    testID: 'sync-status-idle',
  };
}

const LanguageOption = memo(function LanguageOption({
  active,
  label,
  onPress,
  sublabel,
  testID,
  theme,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  sublabel: AtlasLocale | string;
  testID?: string;
  theme: MobileTheme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${sublabel}`}
      onPress={onPress}
      testID={testID}
      style={[
        styles.languageOption,
        { borderColor: theme.panelBorder },
        active ? { backgroundColor: theme.selectedOptionBackground, borderColor: theme.selectedOptionBorder } : null,
      ]}
    >
      <Text
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[styles.languageOptionLabel, { color: active ? theme.selectedOptionText : theme.text }]}
      >
        {label}
      </Text>
      <Text
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[styles.languageOptionSubLabel, { color: active ? theme.selectedOptionMutedText : theme.mutedText }]}
      >
        {sublabel}
      </Text>
    </Pressable>
  );
});

function formatConnectionQuality(state: SyncDashboardState, t: ReturnType<typeof createTranslator>) {
  return state.device?.connectionQuality ?? t('mobile.waiting');
}

const IconMark = memo(function IconMark({ label, color, compact = false }: { label: string; color: string; compact?: boolean }) {
  return (
    <View
      style={[
        styles.iconMark,
        compact ? styles.iconMarkCompact : null,
        { borderColor: color, backgroundColor: compact ? 'transparent' : `${color}18` },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text style={[styles.iconMarkText, compact ? styles.iconMarkTextCompact : null, { color }]}>{label}</Text>
    </View>
  );
});

const InfoTile = memo(function InfoTile({ label, theme, value }: { label: string; theme: MobileTheme; value: string }) {
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.tile, { backgroundColor: theme.panelBackground, borderColor: theme.panelBorder }]}
    >
      <Text style={[styles.tileValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.tileLabel, { color: theme.mutedText }]}>{label}</Text>
    </View>
  );
});

const EmergencyChannelRow = memo(function EmergencyChannelRow({
  channel,
  liveLabel,
  offlineLabel,
  theme,
}: {
  channel: EmergencyChannel;
  liveLabel: string;
  offlineLabel: string;
  theme: MobileTheme;
}) {
  return (
    <View style={[styles.channelRow, { borderColor: theme.rowBorder }]} testID={`emergency-channel-${channel.id}`} accessible accessibilityLabel={`${channel.label}, ${channel.availableOffline ? offlineLabel : liveLabel}`}>
      <View style={styles.channelCopy}>
        <Text style={[styles.channelTitle, { color: theme.text }]}>{channel.label}</Text>
        <Text style={[styles.channelDetail, { color: theme.mutedText }]}>{channel.detail}</Text>
      </View>
      <Text
        style={[
          styles.channelBadge,
          {
            backgroundColor: channel.availableOffline ? theme.offlineBadgeBackground : theme.liveBadgeBackground,
            color: channel.availableOffline ? theme.offlineBadgeText : theme.liveBadgeText,
          },
        ]}
        testID={`emergency-channel-${channel.id}-${channel.availableOffline ? 'offline' : 'live'}`}
      >
        {channel.availableOffline ? offlineLabel : liveLabel}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#eef3f8',
  },
  content: {
    gap: 16,
    minWidth: 0,
    padding: 20,
    width: '100%',
  },
  header: {
    gap: 6,
    minWidth: 0,
    paddingTop: 16,
  },
  headerTopline: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  kicker: {
    color: '#3467eb',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  localeBadge: {
    backgroundColor: '#dbeafe',
    borderRadius: 6,
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  title: {
    color: '#101820',
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: '#526070',
    fontSize: 15,
    lineHeight: 21,
  },
  languagePanel: {
    backgroundColor: '#ffffff',
    borderColor: '#d8e0ec',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    minWidth: 0,
    overflow: 'hidden',
    padding: 14,
    width: '100%',
  },
  languageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  languageTitle: {
    color: '#101820',
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
    minWidth: 0,
  },
  languageHint: {
    color: '#526070',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 0,
    textAlign: 'right',
  },
  languageScroller: {
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    width: '100%',
  },
  languageOptions: {
    gap: 8,
    paddingRight: 4,
  },
  languageOption: {
    borderColor: '#d8e0ec',
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    maxWidth: 136,
    minWidth: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  languageOptionLabel: {
    color: '#101820',
    fontSize: 13,
    fontWeight: '800',
    maxWidth: '100%',
  },
  languageOptionSubLabel: {
    color: '#526070',
    fontSize: 11,
    fontWeight: '700',
    maxWidth: '100%',
  },
  statusPanel: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d8e0ec',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 18,
  },
  statusCopy: {
    flex: 1,
    gap: 4,
  },
  iconMark: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  iconMarkCompact: {
    height: 24,
    width: 24,
  },
  iconMarkText: {
    fontSize: 12,
    fontWeight: '800',
  },
  iconMarkTextCompact: {
    fontSize: 10,
  },
  statusLabel: {
    color: '#101820',
    fontSize: 18,
    fontWeight: '700',
  },
  statusText: {
    color: '#526070',
    fontSize: 14,
    lineHeight: 20,
  },
  errorPanel: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  errorTitle: {
    color: '#9a3412',
    fontSize: 15,
    fontWeight: '800',
  },
  errorText: {
    color: '#7c2d12',
    fontSize: 14,
    lineHeight: 20,
  },
  grid: {
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  tile: {
    backgroundColor: '#ffffff',
    borderColor: '#d8e0ec',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexShrink: 1,
    minHeight: 88,
    minWidth: 0,
    padding: 12,
  },
  tileValue: {
    color: '#101820',
    fontSize: 26,
    fontWeight: '800',
  },
  tileLabel: {
    color: '#526070',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 0,
    textTransform: 'uppercase',
  },
  section: {
    backgroundColor: '#ffffff',
    borderColor: '#d8e0ec',
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  sectionTitle: {
    color: '#101820',
    fontSize: 16,
    fontWeight: '800',
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  detailLabel: {
    color: '#526070',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  detailValue: {
    color: '#101820',
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 0,
    textAlign: 'right',
  },
  commandPreview: {
    backgroundColor: '#101820',
    borderRadius: 8,
    gap: 6,
    padding: 14,
  },
  commandWorkspace: {
    color: '#9fb1c5',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    minWidth: 0,
  },
  commandText: {
    color: '#ffffff',
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    minWidth: 0,
  },
  channelRow: {
    alignItems: 'center',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minWidth: 0,
    padding: 12,
  },
  channelCopy: {
    flex: 1,
    flexShrink: 1,
    gap: 4,
    minWidth: 0,
  },
  channelTitle: {
    color: '#101820',
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
    minWidth: 0,
  },
  channelDetail: {
    color: '#526070',
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    minWidth: 0,
  },
  channelBadge: {
    backgroundColor: '#e0f2fe',
    borderRadius: 6,
    color: '#075985',
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  emptyText: {
    color: '#526070',
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#101820',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
  },
  primaryButtonDisabled: {
    opacity: 0.72,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  rtlBlock: {
    direction: 'rtl',
  },
  rtlText: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
