import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';

import { DEFAULT_LOCALE, detectAtlasLocale, getLocaleMeta, getTextDirection, resolveAtlasLocale } from '@atlasterm/i18n';
import type { AtlasLocale, LocaleMeta } from '@atlasterm/i18n';

export type LocaleMode = 'auto' | AtlasLocale;

export const MOBILE_LOCALE_STORAGE_KEY = 'atlasterm.mobile.language';

export type MobileLocaleState = {
  autoLocale: AtlasLocale;
  candidates: string[];
  direction: 'ltr' | 'rtl';
  locale: AtlasLocale;
  meta: LocaleMeta;
  mode: LocaleMode;
};

export function getMobileLocaleCandidates() {
  const candidates = [
    ...getExpoLocaleCandidates(),
    ...getReactNativeLocaleCandidates(),
    getIntlLocaleCandidate(),
    DEFAULT_LOCALE,
  ];

  return uniqueLocales(candidates);
}

export function resolveMobileLocale(mode: LocaleMode, candidates = getMobileLocaleCandidates()): MobileLocaleState {
  const autoLocale = detectAtlasLocale(candidates);
  const locale = mode === 'auto' ? autoLocale : mode;

  return {
    autoLocale,
    candidates,
    direction: getTextDirection(locale),
    locale,
    meta: getLocaleMeta(locale),
    mode,
  };
}

export async function getStoredMobileLocaleMode(): Promise<LocaleMode> {
  try {
    return getLocaleMode(await AsyncStorage.getItem(MOBILE_LOCALE_STORAGE_KEY)) ?? 'auto';
  } catch {
    return 'auto';
  }
}

export async function persistMobileLocaleMode(mode: LocaleMode): Promise<boolean> {
  try {
    await AsyncStorage.setItem(MOBILE_LOCALE_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

function getExpoLocaleCandidates() {
  const expoConfig = Constants.expoConfig as
    | {
        extra?: Record<string, unknown>;
      }
    | null
    | undefined;
  const manifestLocale = getString(expoConfig?.extra?.locale);
  const manifestRegion = getString(expoConfig?.extra?.region);

  return [manifestLocale, manifestRegion ? `und-${manifestRegion}` : undefined];
}

function getReactNativeLocaleCandidates() {
  const settings = NativeModules.SettingsManager?.settings;
  const i18nConstants = NativeModules.I18nManager?.getConstants?.() ?? NativeModules.I18nManager;

  return [
    settings?.AppleLocale,
    ...(Array.isArray(settings?.AppleLanguages) ? settings.AppleLanguages : []),
    i18nConstants?.localeIdentifier,
    i18nConstants?.locale,
    Platform.OS,
  ];
}

function getIntlLocaleCandidate() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

function uniqueLocales(values: readonly unknown[]) {
  const seen = new Set<string>();
  const locales: string[] = [];

  values.forEach((value) => {
    const locale = getString(value)?.replace(/_/g, '-');

    if (locale && !seen.has(locale)) {
      seen.add(locale);
      locales.push(locale);
    }
  });

  return locales;
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getLocaleMode(value: string | null): LocaleMode | undefined {
  if (value === 'auto') {
    return 'auto';
  }

  return resolveAtlasLocale(value);
}
