import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createLocaleFormatters, SUPPORTED_LOCALES } from "@atlasterm/i18n";
import type { AtlasLocale, Translator } from "@atlasterm/i18n";

import type {
  EmergencyChannel,
  SyncDashboardState,
  SyncError,
} from "@/models/sync";
import type { LocaleMode } from "@/services/locale";
import { useMobileLocale } from "@/services/localeContext";
import {
  asSyncError,
  fetchSyncPreview,
  getOfflineError,
  pushMobilePresenceCheckpoint,
  registerDevice,
} from "@/services/sync";
import { getMobileTheme } from "@/theme";
import type { MobileTheme } from "@/theme";

const initialState: SyncDashboardState = {
  phase: "idle",
};

const languageOptionTestIds = {
  auto: "language-option-auto",
  en: "language-option-en",
} as const;

const syncErrorTestIds = {
  offline: "sync-error-offline-fallback",
  timeout: "sync-error-timeout",
  unauthorized: "sync-error-unauthorized",
  unknown: "sync-error-unknown",
} as const;

export default function HomeScreen() {
  const [syncState, setSyncState] = useState<SyncDashboardState>(initialState);
  const isMountedRef = useRef(true);
  const syncInFlightRef = useRef<Promise<void> | undefined>(undefined);
  const { localeMode, localeState, setLocaleMode, t } = useMobileLocale();
  const colorScheme = useColorScheme();
  const { fontScale, height, width } = useWindowDimensions();
  const theme = getMobileTheme(colorScheme);
  const isCompact = width < 360;
  const isTablet = Math.min(width, height) >= 600;
  const isLargeText = fontScale >= 1.5;
  const useStackedMetrics = isCompact || isLargeText;

  const formatters = useMemo(
    () => createLocaleFormatters(localeState.locale),
    [localeState.locale],
  );
  const status = useMemo(
    () => getStatus(syncState, t, theme),
    [syncState, t, theme],
  );

  function handleLocaleModeChange(mode: LocaleMode) {
    setLocaleMode(mode);
  }

  const isBusy =
    syncState.phase === "registering" || syncState.phase === "previewing";
  const preview = syncState.preview;
  const emergencyChannels = preview?.emergencyChannels ?? [];
  const isRtl = localeState.direction === "rtl";
  const errorUsesWarningTone =
    syncState.error?.code === "offline" || syncState.error?.code === "timeout";
  const statusUsesServiceCopy =
    syncState.phase === "error" && syncState.error?.code !== "offline";
  const statusPanelBorder = syncState.error
    ? errorUsesWarningTone
      ? theme.statusWarningBorder
      : theme.errorBorder
    : theme.panelBorder;
  const errorPanelBorder = errorUsesWarningTone
    ? theme.warningBorder
    : theme.errorBorder;
  const errorPanelAccent = errorUsesWarningTone
    ? theme.statusWarning
    : theme.red;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function runSyncPreview(): Promise<void> {
    if (syncInFlightRef.current) {
      return syncInFlightRef.current;
    }

    const operation = performSyncPreview();
    syncInFlightRef.current = operation;

    try {
      await operation;
    } finally {
      if (syncInFlightRef.current === operation) {
        syncInFlightRef.current = undefined;
      }
    }
  }

  async function performSyncPreview() {
    const lastKnownDevice = syncState.device;
    const lastKnownPreview = syncState.preview;
    let activeDevice = lastKnownDevice;
    let checkpointError: SyncError | undefined;
    updateSyncState({ phase: "registering" });

    try {
      const registeredDevice = await registerDevice();
      const retainedCursor =
        lastKnownDevice?.id === registeredDevice.id
          ? lastKnownDevice.syncCursor
          : undefined;
      const device = retainedCursor
        ? { ...registeredDevice, syncCursor: retainedCursor }
        : registeredDevice;
      activeDevice = device;
      updateSyncState({ device, phase: "previewing" });

      if (device.connectionQuality !== "offline") {
        try {
          await pushMobilePresenceCheckpoint(device);
        } catch (error) {
          // Presence is advisory. A failed checkpoint must not prevent the
          // read-only preview pull from recovering useful workspace context.
          checkpointError = asSyncError(error);
        }
      }

      const nextPreview = await fetchSyncPreview(
        device.id,
        device.syncCursor ?? "0",
      );
      const offlineError =
        device.connectionQuality === "offline" ? getOfflineError() : undefined;
      const syncedDevice = nextPreview.syncCursor
        ? { ...device, syncCursor: nextPreview.syncCursor }
        : device;

      updateSyncState({
        device: syncedDevice,
        error: offlineError ?? checkpointError,
        phase: offlineError ? "offline" : "ready",
        preview: nextPreview,
      });
    } catch (error) {
      const syncError = asSyncError(error);
      const failedDevice = activeDevice
        ? {
            ...activeDevice,
            connectionQuality:
              syncError.code === "offline"
                ? ("offline" as const)
                : syncError.code === "timeout" || syncError.code === "unknown"
                  ? ("degraded" as const)
                  : activeDevice.connectionQuality,
          }
        : undefined;

      updateSyncState({
        device: failedDevice,
        error: syncError,
        phase: "error",
        preview: lastKnownPreview,
      });
    }
  }

  function updateSyncState(nextState: SyncDashboardState) {
    if (isMountedRef.current) {
      setSyncState(nextState);
    }
  }

  return (
    <SafeAreaView
      accessibilityLanguage={localeState.locale}
      style={{ backgroundColor: theme.screenBackground, flex: 1 }}
    >
      <ScrollView
        automaticallyAdjustsScrollIndicatorInsets
        style={{ backgroundColor: theme.screenBackground }}
        contentContainerStyle={[
          styles.content,
          isCompact ? styles.contentCompact : null,
          isTablet ? styles.contentTablet : null,
        ]}
        showsVerticalScrollIndicator={false}
        testID="mobile-home-root"
      >
        <View
          style={[
            styles.hero,
            {
              backgroundColor: theme.heroBackground,
              borderColor: theme.panelBorder,
              boxShadow: theme.heroShadow,
            },
            isTablet ? styles.heroTablet : null,
          ]}
        >
          <View
            style={[
              styles.heroAtmosphere,
              isRtl ? styles.heroAtmosphereRtl : null,
              { backgroundColor: theme.accentSoft },
            ]}
          />
          <View
            style={[
              styles.headerTopline,
              isRtl ? styles.rtlRow : null,
              isLargeText ? styles.headerToplineLargeText : null,
              isLargeText && isRtl ? styles.largeTextRtl : null,
            ]}
          >
            <View style={[styles.brandLockup, isRtl ? styles.rtlRow : null]}>
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
              <Text
                style={[
                  styles.kicker,
                  { color: theme.accentText },
                  isRtl ? styles.rtlText : null,
                ]}
              >
                {t("mobile.kicker")}
              </Text>
            </View>
            <Text
              style={[
                styles.localeBadge,
                {
                  backgroundColor: theme.localeBadgeBackground,
                  color: theme.localeBadgeText,
                },
              ]}
            >
              {localeState.meta.nativeName}
            </Text>
          </View>
          <View style={styles.heroCopy}>
            <Text
              accessibilityRole="header"
              style={[
                styles.title,
                { color: theme.text },
                isCompact ? styles.titleCompact : null,
                isTablet ? styles.titleTablet : null,
                isRtl ? styles.rtlText : null,
              ]}
            >
              {t("mobile.title")}
            </Text>
            <Text
              style={[
                styles.subtitle,
                { color: theme.mutedText },
                isTablet ? styles.subtitleTablet : null,
                isRtl ? styles.rtlText : null,
              ]}
            >
              {t("mobile.subtitle")}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.languagePanel,
            {
              backgroundColor: theme.panelBackground,
              borderColor: theme.panelBorder,
              boxShadow: theme.surfaceShadow,
            },
          ]}
          testID="language-panel"
        >
          <View
            style={[
              styles.languageHeader,
              isCompact || isLargeText ? styles.languageHeaderCompact : null,
              isRtl && !isCompact && !isLargeText ? styles.rtlRow : null,
              isRtl && (isCompact || isLargeText) ? styles.largeTextRtl : null,
            ]}
            testID="language-panel-header"
          >
            <View
              style={[styles.sectionHeadingGroup, isRtl ? styles.rtlRow : null]}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[
                  styles.sectionGlyph,
                  {
                    backgroundColor: theme.accentSoft,
                    borderColor: theme.panelBorder,
                  },
                ]}
              >
                <Text
                  style={[styles.sectionGlyphText, { color: theme.accent }]}
                >
                  Aa
                </Text>
              </View>
              <Text
                style={[
                  styles.languageTitle,
                  { color: theme.text },
                  isRtl ? styles.rtlText : null,
                ]}
              >
                {t("language.selectorLabel")}
              </Text>
            </View>
            <Text
              style={[
                styles.languageHint,
                { color: theme.mutedText },
                isCompact || isLargeText ? styles.languageHintCompact : null,
                isRtl ? styles.rtlText : null,
              ]}
            >
              {t("language.worldReady")}
            </Text>
          </View>
          <ScrollView
            accessibilityLabel={t("language.selectorLabel")}
            accessibilityRole="radiogroup"
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.languageScroller}
            contentContainerStyle={[
              styles.languageOptions,
              isRtl ? styles.rtlLanguageOptions : null,
            ]}
          >
            <LanguageOption
              active={localeMode === "auto"}
              label={t("language.autoRegion")}
              sublabel={localeState.autoLocale}
              testID={languageOptionTestIds.auto}
              theme={theme}
              onPress={() => handleLocaleModeChange("auto")}
            />
            {SUPPORTED_LOCALES.map((locale) => (
              <LanguageOption
                active={localeMode === locale.code}
                key={locale.code}
                label={locale.nativeName}
                sublabel={locale.code}
                testID={
                  locale.code === "en"
                    ? languageOptionTestIds.en
                    : `language-option-${locale.code}`
                }
                theme={theme}
                onPress={() => handleLocaleModeChange(locale.code)}
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.syncStack}>
          <View
            accessible
            accessibilityLabel={`${status.label}. ${status.message}`}
            accessibilityRole="summary"
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy: isBusy }}
            style={[
              styles.statusPanel,
              {
                backgroundColor: theme.panelBackground,
                borderColor: statusPanelBorder,
                borderLeftColor: isRtl ? statusPanelBorder : status.color,
                borderLeftWidth: isRtl ? 1 : 4,
                borderRightColor: isRtl ? status.color : statusPanelBorder,
                borderRightWidth: isRtl ? 4 : 1,
                boxShadow: theme.surfaceShadow,
              },
              isRtl ? styles.rtlRow : null,
            ]}
            testID="sync-status-panel"
          >
            <IconMark label={status.icon} color={status.color} />
            <View style={styles.statusCopy}>
              <Text
                style={[
                  styles.statusLabel,
                  { color: theme.text },
                  isRtl
                    ? statusUsesServiceCopy
                      ? styles.rtlAutoText
                      : styles.rtlText
                    : null,
                ]}
                testID={status.testID}
              >
                {status.label}
              </Text>
              <Text
                style={[
                  styles.statusText,
                  { color: theme.mutedText },
                  isRtl
                    ? statusUsesServiceCopy
                      ? styles.rtlAutoText
                      : styles.rtlText
                    : null,
                ]}
              >
                {status.message}
              </Text>
            </View>
            {isBusy ? (
              <ActivityIndicator
                accessibilityElementsHidden
                color={status.color}
                importantForAccessibility="no"
                size="small"
              />
            ) : null}
          </View>

          {syncState.error ? (
            <View
              accessible
              accessibilityLabel={`${syncState.error.title}. ${syncState.error.message}`}
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              style={[
                styles.errorPanel,
                {
                  backgroundColor: errorUsesWarningTone
                    ? theme.warningBackground
                    : theme.errorBackground,
                  borderColor: errorPanelBorder,
                  borderLeftColor: isRtl ? errorPanelBorder : errorPanelAccent,
                  borderLeftWidth: isRtl ? 1 : 4,
                  borderRightColor: isRtl ? errorPanelAccent : errorPanelBorder,
                  borderRightWidth: isRtl ? 4 : 1,
                },
                isRtl ? styles.rtlRow : null,
              ]}
              testID="sync-error-panel"
            >
              <IconMark
                color={errorUsesWarningTone ? theme.statusWarning : theme.red}
                label={syncState.error.code === "unauthorized" ? "ID" : "!"}
              />
              <View style={styles.errorCopy}>
                <Text
                  style={[
                    styles.errorTitle,
                    {
                      color: errorUsesWarningTone
                        ? theme.warningText
                        : theme.errorTitle,
                    },
                    isRtl ? styles.rtlAutoText : null,
                  ]}
                  testID={syncErrorTestIds[syncState.error.code]}
                >
                  {syncState.error.title}
                </Text>
                <Text
                  style={[
                    styles.errorText,
                    {
                      color: errorUsesWarningTone
                        ? theme.warningText
                        : theme.errorText,
                    },
                    isRtl ? styles.rtlAutoText : null,
                  ]}
                >
                  {syncState.error.message}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            styles.primaryButton,
            {
              backgroundColor: pressed
                ? theme.primaryButtonPressed
                : theme.primaryButtonBackground,
              borderColor: theme.primaryButtonPressed,
              boxShadow: theme.actionShadow,
            },
            pressed && !isBusy ? styles.primaryButtonPressed : null,
            isBusy ? styles.primaryButtonDisabled : null,
            isRtl ? styles.rtlRow : null,
          ]}
          onPress={runSyncPreview}
          accessibilityLabel={
            isBusy ? t("mobile.preparing") : t("mobile.registerPull")
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy, busy: isBusy }}
          disabled={isBusy}
          focusable={!isBusy}
          testID="sync-primary-action"
        >
          <IconMark
            label={isBusy ? "..." : "GO"}
            color={theme.primaryButtonText}
            compact
          />
          <Text
            style={[
              styles.primaryButtonText,
              { color: theme.primaryButtonText },
              isRtl ? styles.rtlText : null,
            ]}
          >
            {isBusy ? t("mobile.preparing") : t("mobile.registerPull")}
          </Text>
        </Pressable>

        <View
          style={[
            styles.grid,
            isRtl ? styles.rtlRow : null,
            useStackedMetrics ? styles.gridStacked : null,
          ]}
          testID="sync-metrics-grid"
        >
          <InfoTile
            accent={theme.accent}
            isRtl={isRtl}
            label={t("mobile.profiles")}
            value={formatters.number(preview?.profileCount ?? 0)}
            theme={theme}
          />
          <InfoTile
            accent={theme.blue}
            isRtl={isRtl}
            label={t("mobile.openSessions")}
            value={formatters.number(preview?.openSessionCount ?? 0)}
            theme={theme}
          />
          <InfoTile
            accent={theme.violet}
            isRtl={isRtl}
            label={t("mobile.pendingChanges")}
            value={formatters.number(preview?.pendingChangeCount ?? 0)}
            theme={theme}
          />
        </View>

        <View
          style={[
            styles.detailGrid,
            isTablet ? styles.detailGridTablet : null,
            isTablet && isRtl ? styles.rtlRow : null,
          ]}
          testID="sync-detail-grid"
        >
          <View
            style={[
              styles.section,
              {
                backgroundColor: theme.panelBackground,
                borderColor: theme.panelBorder,
                boxShadow: theme.surfaceShadow,
              },
              isTablet ? styles.sectionTablet : null,
            ]}
          >
            <SectionHeader
              glyph="DV"
              isRtl={isRtl}
              title={t("mobile.deviceRegistration")}
              theme={theme}
            />
            <View
              style={[
                styles.detailRow,
                isRtl ? styles.rtlRow : null,
                isLargeText ? styles.detailRowLargeText : null,
                isLargeText && isRtl ? styles.detailRowLargeTextRtl : null,
              ]}
              testID="sync-device-row"
            >
              <Text
                style={[
                  styles.detailLabel,
                  { color: theme.mutedText },
                  isRtl ? styles.rtlText : null,
                ]}
              >
                {t("mobile.device")}
              </Text>
              <Text
                style={[
                  styles.detailValue,
                  { color: theme.text },
                  isRtl ? styles.detailValueRtl : null,
                  isLargeText ? styles.detailValueLargeText : null,
                  isLargeText && isRtl ? styles.detailValueLargeTextRtl : null,
                ]}
              >
                {syncState.device?.name ?? t("mobile.notRegistered")}
              </Text>
            </View>
            <View
              style={[
                styles.detailDivider,
                { backgroundColor: theme.rowBorder },
              ]}
            />
            <View
              style={[
                styles.detailRow,
                isRtl ? styles.rtlRow : null,
                isLargeText ? styles.detailRowLargeText : null,
                isLargeText && isRtl ? styles.detailRowLargeTextRtl : null,
              ]}
              testID="sync-quality-row"
            >
              <Text
                style={[
                  styles.detailLabel,
                  { color: theme.mutedText },
                  isRtl ? styles.rtlText : null,
                ]}
              >
                {t("mobile.quality")}
              </Text>
              <View
                style={[
                  styles.qualityBadge,
                  isRtl ? styles.rtlRow : null,
                  {
                    alignSelf:
                      isLargeText && isRtl
                        ? "flex-end"
                        : isLargeText
                          ? "flex-start"
                          : "auto",
                    backgroundColor: theme.accentSoft,
                    borderColor: theme.panelBorder,
                  },
                ]}
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={[
                    styles.qualityDot,
                    {
                      backgroundColor:
                        syncState.device?.connectionQuality === "online"
                          ? theme.statusReady
                          : syncState.device?.connectionQuality === "offline"
                            ? theme.statusWarning
                            : theme.faintText,
                    },
                  ]}
                />
                <Text
                  style={[styles.qualityText, { color: theme.text }]}
                  testID="sync-device-quality"
                >
                  {formatConnectionQuality(syncState, t)}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={[
              styles.section,
              {
                backgroundColor: theme.panelBackground,
                borderColor: theme.panelBorder,
                boxShadow: theme.surfaceShadow,
              },
              isTablet ? styles.sectionTablet : null,
            ]}
          >
            <SectionHeader
              glyph=">_"
              isRtl={isRtl}
              title={t("mobile.pullPreview")}
              theme={theme}
            />
            <View
              style={[
                styles.commandPreview,
                {
                  backgroundColor: theme.commandBackground,
                  borderColor: theme.borderStrong,
                },
              ]}
            >
              <View style={styles.commandChrome}>
                <View style={styles.commandDots}>
                  <View
                    style={[styles.commandDot, { backgroundColor: theme.red }]}
                  />
                  <View
                    style={[
                      styles.commandDot,
                      { backgroundColor: theme.statusIdle },
                    ]}
                  />
                  <View
                    style={[
                      styles.commandDot,
                      { backgroundColor: theme.statusReady },
                    ]}
                  />
                </View>
                <Text
                  style={[
                    styles.commandMode,
                    { color: theme.commandMutedText },
                  ]}
                >
                  SSH
                </Text>
              </View>
              <Text
                style={[
                  styles.commandWorkspace,
                  { color: theme.commandMutedText },
                  styles.ltrCode,
                ]}
                testID="sync-preview-workspace"
              >
                {preview?.cursor.workspace || t("mobile.noWorkspace")}
              </Text>
              <Text
                style={[
                  styles.commandText,
                  { color: theme.commandText },
                  styles.ltrCode,
                ]}
                testID="sync-preview-command"
              >
                {preview?.cursor.branch || preview?.cursor.lastCommand
                  ? `${preview.cursor.branch} / ${preview.cursor.lastCommand}`
                  : t("mobile.runPreview")}
              </Text>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.section,
            {
              backgroundColor: theme.panelBackground,
              borderColor: theme.panelBorder,
              boxShadow: theme.surfaceShadow,
            },
          ]}
        >
          <SectionHeader
            glyph="RX"
            isRtl={isRtl}
            title={t("mobile.emergencyConnection")}
            theme={theme}
          />
          {emergencyChannels.length > 0 ? (
            emergencyChannels.map((channel) => (
              <EmergencyChannelRow
                key={channel.id}
                channel={channel}
                isLargeText={isLargeText}
                isRtl={isRtl}
                liveLabel={t("mobile.liveBadge")}
                offlineLabel={t("mobile.offlineBadge")}
                theme={theme}
              />
            ))
          ) : (
            <View
              style={[
                styles.emptyState,
                {
                  backgroundColor: theme.panelStrong,
                  borderColor: theme.panelBorder,
                },
                isRtl ? styles.rtlRow : null,
              ]}
              testID="emergency-channels-empty"
            >
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[styles.emptyGlyph, { color: theme.faintText }]}
              >
                --
              </Text>
              <Text
                style={[
                  styles.emptyText,
                  { color: theme.mutedText },
                  isRtl ? styles.rtlText : null,
                ]}
              >
                {t("mobile.emptyRoutes")}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getStatus(
  state: SyncDashboardState,
  t: Translator,
  theme: MobileTheme,
) {
  if (state.phase === "registering") {
    return {
      color: theme.statusBusy,
      icon: "ID",
      label: t("mobile.registering"),
      message: t("mobile.registeringMessage"),
      testID: "sync-status-registering",
    };
  }

  if (state.phase === "previewing") {
    return {
      color: theme.statusBusy,
      icon: "SY",
      label: t("mobile.previewing"),
      message: t("mobile.previewingMessage"),
      testID: "sync-status-previewing",
    };
  }

  if (state.phase === "ready") {
    return {
      color: theme.statusReady,
      icon: "OK",
      label: t("mobile.ready"),
      message: t("mobile.readyMessage"),
      testID: "sync-status-ready",
    };
  }

  if (state.phase === "offline") {
    return {
      color: theme.statusWarning,
      icon: "OF",
      label: t("mobile.offline"),
      message: t("mobile.offlineMessage"),
      testID: "sync-status-offline",
    };
  }

  if (state.phase === "error") {
    const error = state.error;
    const isOfflineError = error?.code === "offline";
    const isWarning = isOfflineError || error?.code === "timeout";

    return {
      color: isWarning ? theme.statusWarning : theme.red,
      icon: error?.code === "unauthorized" ? "ID" : isOfflineError ? "OF" : "!",
      label: isOfflineError
        ? t("mobile.offline")
        : (error?.title ?? t("mobile.offline")),
      message: isOfflineError
        ? t("mobile.offlineMessage")
        : (error?.message ?? t("mobile.offlineMessage")),
      testID: isOfflineError
        ? "sync-status-offline"
        : `sync-status-error-${error?.code ?? "unknown"}`,
    };
  }

  return {
    color: theme.statusIdle,
    icon: "RD",
    label: t("mobile.readyToConnect"),
    message: t("mobile.readyToConnectMessage"),
    testID: "sync-status-idle",
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
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label}, ${sublabel}`}
      accessibilityState={{ checked: active, selected: active }}
      focusable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      testID={testID}
      style={[
        styles.languageOption,
        { borderColor: theme.panelBorder },
        active
          ? {
              backgroundColor: theme.selectedOptionBackground,
              borderColor: theme.selectedOptionBorder,
            }
          : null,
        pressed
          ? {
              backgroundColor: active ? theme.accentStrong : theme.panelPressed,
            }
          : null,
        pressed ? styles.languageOptionPressed : null,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          styles.languageSelectionMark,
          {
            backgroundColor: active
              ? theme.selectedOptionText
              : theme.panelBorder,
          },
        ]}
      />
      <Text
        style={[
          styles.languageOptionLabel,
          { color: active ? theme.selectedOptionText : theme.text },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.languageOptionSubLabel,
          { color: active ? theme.selectedOptionMutedText : theme.mutedText },
          styles.ltrCode,
        ]}
      >
        {sublabel}
      </Text>
    </Pressable>
  );
});

function formatConnectionQuality(state: SyncDashboardState, t: Translator) {
  return state.device?.connectionQuality ?? t("mobile.waiting");
}

const IconMark = memo(function IconMark({
  label,
  color,
  compact = false,
}: {
  label: string;
  color: string;
  compact?: boolean;
}) {
  return (
    <View
      style={[
        styles.iconMark,
        compact ? styles.iconMarkCompact : null,
        {
          borderColor: color,
          backgroundColor: compact ? "transparent" : `${color}18`,
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text
        style={[
          styles.iconMarkText,
          compact ? styles.iconMarkTextCompact : null,
          { color },
        ]}
      >
        {label}
      </Text>
    </View>
  );
});

const InfoTile = memo(function InfoTile({
  accent,
  isRtl,
  label,
  theme,
  value,
}: {
  accent: string;
  isRtl: boolean;
  label: string;
  theme: MobileTheme;
  value: string;
}) {
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${label}: ${value}`}
      style={[
        styles.tile,
        {
          backgroundColor: theme.panelBackground,
          borderColor: theme.panelBorder,
          boxShadow: theme.surfaceShadow,
        },
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.tileAccent, { backgroundColor: accent }]}
      />
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        numberOfLines={1}
        style={[styles.tileValue, { color: theme.text }]}
      >
        {value}
      </Text>
      <Text
        style={[
          styles.tileLabel,
          { color: theme.mutedText },
          isRtl ? styles.rtlText : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
});

const SectionHeader = memo(function SectionHeader({
  glyph,
  isRtl,
  theme,
  title,
}: {
  glyph: string;
  isRtl: boolean;
  theme: MobileTheme;
  title: string;
}) {
  return (
    <View style={[styles.sectionHeader, isRtl ? styles.rtlRow : null]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          styles.sectionGlyph,
          {
            backgroundColor: theme.accentSoft,
            borderColor: theme.panelBorder,
          },
        ]}
      >
        <Text style={[styles.sectionGlyphText, { color: theme.accent }]}>
          {glyph}
        </Text>
      </View>
      <Text
        accessibilityRole="header"
        style={[
          styles.sectionTitle,
          { color: theme.text },
          isRtl ? styles.rtlText : null,
        ]}
      >
        {title}
      </Text>
    </View>
  );
});

const EmergencyChannelRow = memo(function EmergencyChannelRow({
  channel,
  isLargeText,
  isRtl,
  liveLabel,
  offlineLabel,
  theme,
}: {
  channel: EmergencyChannel;
  isLargeText: boolean;
  isRtl: boolean;
  liveLabel: string;
  offlineLabel: string;
  theme: MobileTheme;
}) {
  return (
    <View
      style={[
        styles.channelRow,
        {
          backgroundColor: theme.panelStrong,
          borderColor: theme.rowBorder,
        },
        isRtl ? styles.rtlRow : null,
        isLargeText ? styles.channelRowLargeText : null,
        isLargeText && isRtl ? styles.channelRowLargeTextRtl : null,
      ]}
      testID={`emergency-channel-${channel.id}`}
      accessible
      accessibilityLabel={`${channel.label}. ${channel.detail}. ${channel.availableOffline ? offlineLabel : liveLabel}`}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          styles.channelGlyph,
          {
            backgroundColor: channel.availableOffline
              ? theme.offlineBadgeBackground
              : theme.liveBadgeBackground,
          },
          isLargeText ? { alignSelf: isRtl ? "flex-end" : "flex-start" } : null,
        ]}
      >
        <Text
          style={[
            styles.channelGlyphText,
            {
              color: channel.availableOffline
                ? theme.offlineBadgeText
                : theme.liveBadgeText,
            },
          ]}
        >
          {channel.availableOffline ? "KEY" : "NET"}
        </Text>
      </View>
      <View style={styles.channelCopy}>
        <Text
          style={[
            styles.channelTitle,
            { color: theme.text },
            isRtl ? styles.rtlAutoText : null,
          ]}
        >
          {channel.label}
        </Text>
        <Text
          style={[
            styles.channelDetail,
            { color: theme.mutedText },
            isRtl ? styles.rtlAutoText : null,
          ]}
        >
          {channel.detail}
        </Text>
      </View>
      <Text
        style={[
          styles.channelBadge,
          {
            backgroundColor: channel.availableOffline
              ? theme.offlineBadgeBackground
              : theme.liveBadgeBackground,
            color: channel.availableOffline
              ? theme.offlineBadgeText
              : theme.liveBadgeText,
          },
          isLargeText ? { alignSelf: isRtl ? "flex-end" : "flex-start" } : null,
        ]}
        testID={`emergency-channel-${channel.id}-${channel.availableOffline ? "offline" : "live"}`}
      >
        {channel.availableOffline ? offlineLabel : liveLabel}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    gap: 16,
    maxWidth: 1040,
    minWidth: 0,
    paddingBottom: 40,
    paddingHorizontal: 20,
    paddingTop: 16,
    width: "100%",
  },
  contentCompact: {
    gap: 12,
    paddingBottom: 32,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  contentTablet: {
    gap: 20,
    paddingBottom: 52,
    paddingHorizontal: 32,
    paddingTop: 28,
  },
  hero: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 18,
    minWidth: 0,
    overflow: "hidden",
    padding: 20,
    position: "relative",
  },
  heroTablet: {
    justifyContent: "space-between",
    minHeight: 240,
    padding: 28,
  },
  heroAtmosphere: {
    borderRadius: 110,
    height: 220,
    opacity: 0.72,
    pointerEvents: "none",
    position: "absolute",
    right: -64,
    top: -132,
    width: 220,
  },
  heroAtmosphereRtl: {
    left: -64,
    right: "auto",
  },
  headerTopline: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minWidth: 0,
  },
  headerToplineLargeText: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  largeTextRtl: {
    alignItems: "flex-end",
  },
  brandLockup: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 11,
    minWidth: 0,
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
  kicker: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
    minWidth: 0,
    textTransform: "uppercase",
  },
  localeBadge: {
    borderRadius: 999,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroCopy: {
    gap: 8,
    maxWidth: 760,
    minWidth: 0,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 40,
  },
  titleCompact: {
    fontSize: 30,
    lineHeight: 36,
  },
  titleTablet: {
    fontSize: 44,
    letterSpacing: -1.2,
    lineHeight: 51,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 720,
  },
  subtitleTablet: {
    fontSize: 17,
    lineHeight: 26,
  },
  languagePanel: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    minWidth: 0,
    overflow: "hidden",
    padding: 14,
    width: "100%",
  },
  languageHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minWidth: 0,
  },
  languageHeaderCompact: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: 7,
  },
  sectionHeadingGroup: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 10,
    minWidth: 0,
  },
  sectionGlyph: {
    alignItems: "center",
    borderRadius: 9,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  sectionGlyphText: {
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  languageTitle: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "800",
    minWidth: 0,
  },
  languageHint: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    minWidth: 0,
    textAlign: "right",
  },
  languageHintCompact: {
    paddingHorizontal: 2,
    textAlign: "left",
  },
  languageScroller: {
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    width: "100%",
  },
  languageOptions: {
    gap: 8,
    paddingHorizontal: 1,
    paddingVertical: 1,
  },
  rtlLanguageOptions: {
    flexDirection: "row-reverse",
  },
  languageOption: {
    borderRadius: 11,
    borderWidth: 1,
    gap: 3,
    justifyContent: "center",
    maxWidth: 196,
    minHeight: 56,
    minWidth: 128,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 9,
    position: "relative",
  },
  languageOptionPressed: {
    transform: [{ scale: 0.98 }],
  },
  languageSelectionMark: {
    height: 3,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  languageOptionLabel: {
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    maxWidth: "100%",
  },
  languageOptionSubLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    maxWidth: "100%",
  },
  syncStack: {
    gap: 10,
    minWidth: 0,
  },
  statusPanel: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    minHeight: 96,
    padding: 16,
  },
  statusCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  iconMark: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    flexShrink: 0,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  iconMarkCompact: {
    borderRadius: 7,
    height: 26,
    width: 26,
  },
  iconMarkText: {
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
  },
  iconMarkTextCompact: {
    fontSize: 10,
  },
  statusLabel: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 21,
  },
  errorPanel: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    minHeight: 88,
    padding: 16,
  },
  errorCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  errorText: {
    fontSize: 14,
    lineHeight: 21,
  },
  grid: {
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  gridStacked: {
    flexDirection: "column",
  },
  tile: {
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexShrink: 1,
    gap: 7,
    justifyContent: "flex-end",
    minHeight: 108,
    minWidth: 0,
    overflow: "hidden",
    padding: 14,
    position: "relative",
  },
  tileAccent: {
    height: 3,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  tileValue: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  tileLabel: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.35,
    lineHeight: 15,
    minWidth: 0,
    textTransform: "uppercase",
  },
  detailGrid: {
    gap: 14,
    minWidth: 0,
  },
  detailGridTablet: {
    alignItems: "stretch",
    flexDirection: "row",
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 14,
    minWidth: 0,
    padding: 16,
  },
  sectionTablet: {
    flex: 1,
    minWidth: 0,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 34,
    minWidth: 0,
  },
  sectionTitle: {
    flex: 1,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
    minWidth: 0,
  },
  detailRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 44,
    minWidth: 0,
  },
  detailRowLargeText: {
    alignItems: "stretch",
    flexDirection: "column",
    gap: 6,
  },
  detailRowLargeTextRtl: {
    alignItems: "stretch",
  },
  detailLabel: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },
  detailValue: {
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "700",
    minWidth: 0,
    textAlign: "right",
  },
  detailValueRtl: {
    textAlign: "left",
    writingDirection: "auto",
  },
  detailValueLargeText: {
    textAlign: "left",
    width: "100%",
  },
  detailValueLargeTextRtl: {
    textAlign: "right",
  },
  detailDivider: {
    height: 1,
    width: "100%",
  },
  qualityBadge: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 32,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  qualityDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  qualityText: {
    fontSize: 12,
    fontWeight: "800",
  },
  commandPreview: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    minHeight: 118,
    padding: 14,
  },
  commandChrome: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  commandDots: {
    flexDirection: "row",
    gap: 6,
  },
  commandDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  commandMode: {
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  commandWorkspace: {
    flexShrink: 1,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
    minWidth: 0,
  },
  commandText: {
    flexShrink: 1,
    fontFamily: "monospace",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    minWidth: 0,
  },
  channelRow: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    minWidth: 0,
    padding: 12,
  },
  channelRowLargeText: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  channelRowLargeTextRtl: {
    alignItems: "stretch",
  },
  channelGlyph: {
    alignItems: "center",
    borderRadius: 10,
    flexShrink: 0,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  channelGlyphText: {
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  channelCopy: {
    flex: 1,
    flexShrink: 1,
    gap: 4,
    minWidth: 0,
  },
  channelTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "800",
    minWidth: 0,
  },
  channelDetail: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    minWidth: 0,
  },
  channelBadge: {
    borderRadius: 999,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "800",
    minHeight: 28,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  emptyState: {
    alignItems: "center",
    borderRadius: 12,
    borderStyle: "dashed",
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 96,
    padding: 16,
  },
  emptyGlyph: {
    fontFamily: "monospace",
    fontSize: 18,
    fontWeight: "800",
  },
  emptyText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    minWidth: 0,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 12,
    width: "100%",
  },
  primaryButtonPressed: {
    transform: [{ scale: 0.985 }, { translateY: 1 }],
  },
  primaryButtonDisabled: {
    opacity: 0.62,
  },
  primaryButtonText: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.1,
    minWidth: 0,
    textAlign: "center",
  },
  rtlRow: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  rtlAutoText: {
    textAlign: "right",
    writingDirection: "auto",
  },
  ltrCode: {
    textAlign: "left",
    writingDirection: "ltr",
  },
});
