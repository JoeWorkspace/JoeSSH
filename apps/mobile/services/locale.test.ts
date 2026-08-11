import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({
  asyncStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
  constants: {
    deviceName: 'Test Device',
    expoConfig: { version: '1.0.0' },
    sessionId: 'test-session',
  },
  platform: { OS: 'android' as const },
}));

vi.mock('expo-constants', () => ({
  default: nativeMocks.constants,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: nativeMocks.asyncStorage,
}));

vi.mock('react-native', () => ({
  Platform: nativeMocks.platform,
  NativeModules: {},
}));

import { MOBILE_LOCALE_STORAGE_KEY, getStoredMobileLocaleMode, persistMobileLocaleMode, resolveMobileLocale } from './locale';
import { DEFAULT_LOCALE, type AtlasLocale } from '@atlasterm/i18n';

const VALID_LOCALES: AtlasLocale[] = [
  'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de',
  'pt-BR', 'ru', 'ar', 'hi', 'id', 'vi', 'th',
];

describe('resolveMobileLocale', () => {
  beforeEach(() => {
    nativeMocks.asyncStorage.getItem.mockReset();
    nativeMocks.asyncStorage.setItem.mockReset();
  });

  it('returns MobileLocaleState with registered locale for mode=auto', () => {
    const result = resolveMobileLocale('auto');
    expect(VALID_LOCALES).toContain(result.locale);
    expect(VALID_LOCALES).toContain(result.autoLocale);
    expect(result.mode).toBe('auto');
    expect(result.direction).toMatch(/^(ltr|rtl)$/);
    expect(result.meta).toBeTruthy();
    expect(result.meta.code).toBeTruthy();
  });

  it('returns explicit locale when given a specific AtlasLocale', () => {
    const result = resolveMobileLocale('zh-CN');
    expect(result.locale).toBe('zh-CN');
    expect(result.mode).toBe('zh-CN');
    expect(result.direction).toBe('ltr');
  });

  it('returns en locale with correct meta when given en', () => {
    const result = resolveMobileLocale('en');
    expect(result.locale).toBe('en');
    expect(result.mode).toBe('en');
    expect(result.meta.code).toBe('en');
  });

  it('includes candidates array with at least DEFAULT_LOCALE', () => {
    const result = resolveMobileLocale('auto');
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates).toContain(DEFAULT_LOCALE);
  });

  it('respects explicit locale override', () => {
    const result = resolveMobileLocale('ar');
    expect(result.locale).toBe('ar');
    expect(result.direction).toBe('rtl');
    expect(result.meta.code).toBe('ar');
  });

  it('returns meta with expected shape', () => {
    const result = resolveMobileLocale('auto');
    expect(result.meta).toHaveProperty('code');
    expect(result.meta).toHaveProperty('direction');
    expect(result.meta).toHaveProperty('englishName');
    expect(result.meta).toHaveProperty('nativeName');
    expect(result.meta).toHaveProperty('regions');
    expect(Array.isArray(result.meta.regions)).toBe(true);
  });

  it('loads a persisted explicit mobile locale mode', async () => {
    nativeMocks.asyncStorage.getItem.mockResolvedValue('pt-BR');

    await expect(getStoredMobileLocaleMode()).resolves.toBe('pt-BR');
    expect(nativeMocks.asyncStorage.getItem).toHaveBeenCalledWith(MOBILE_LOCALE_STORAGE_KEY);
  });

  it('falls back to auto when persisted mobile locale mode is invalid or unavailable', async () => {
    nativeMocks.asyncStorage.getItem.mockResolvedValueOnce('not-a-locale').mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(getStoredMobileLocaleMode()).resolves.toBe('auto');
    await expect(getStoredMobileLocaleMode()).resolves.toBe('auto');
  });

  it('persists explicit and auto mobile locale modes without throwing on storage failures', async () => {
    nativeMocks.asyncStorage.setItem.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(persistMobileLocaleMode('ar')).resolves.toBe(true);
    await expect(persistMobileLocaleMode('auto')).resolves.toBe(false);

    expect(nativeMocks.asyncStorage.setItem).toHaveBeenNthCalledWith(1, MOBILE_LOCALE_STORAGE_KEY, 'ar');
    expect(nativeMocks.asyncStorage.setItem).toHaveBeenNthCalledWith(2, MOBILE_LOCALE_STORAGE_KEY, 'auto');
  });
});
