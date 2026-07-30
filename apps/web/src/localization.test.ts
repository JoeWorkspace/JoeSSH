import { afterEach, describe, expect, it, vi } from 'vitest';

import * as i18n from '@atlasterm/i18n';
import { SUPPORTED_LOCALES } from '@atlasterm/i18n';

import {
  applyDocumentLocale,
  createWebTranslator,
  createWebTranslatorAsync,
  getInitialLanguageChoice,
  getLocalMessageKeys,
  persistLanguageChoice,
  resolveLanguageChoice,
} from './localization';

const mojibakeFingerprints = [
  '\u934f\u3224\u69e6',
  '\u93bc\u6eef\u5132',
  '\u7f01\u5802',
  '\u935b\u4ecb',
  '\u7039\u7481',
  '\u7481\u60e7',
  '\u5a75\u65c1',
  '\u93c3\u7281',
  '\u95c7',
  '\u55d4',
  '\u5576',
  '\u888a',
  '\u4e15\u8ce1',
  '\u00c3',
  '\u00c2',
  '\u00e2\u20ac',
  '\ufffd',
];

function expectReadableText(value: string) {
  for (const fingerprint of mojibakeFingerprints) {
    expect(value).not.toContain(fingerprint);
  }
}

function stubWindow(search: string, storedValue: string | null = null) {
  const storage = new Map<string, string>();

  if (storedValue) {
    storage.set('atlasterm.web.language', storedValue);
  }

  vi.stubGlobal('window', {
    location: { search },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });

  return storage;
}

describe('web localization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses an explicit URL language before stored preferences', () => {
    stubWindow('?lang=ar-SA', 'en');

    expect(getInitialLanguageChoice()).toBe('ar');

    stubWindow('?lang=%20ar-SA%20', 'en');

    expect(getInitialLanguageChoice()).toBe('en');

    stubWindow(`?lang=ar-SA${encodeURIComponent(String.fromCodePoint(0x202e))}`, 'ja');

    expect(getInitialLanguageChoice()).toBe('ja');
  });

  it('uses a stored language when the URL has no override', () => {
    stubWindow('', 'pt-BR');

    expect(getInitialLanguageChoice()).toBe('pt-BR');
  });

  it('falls back to auto when stored language cannot be read', () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: {
        getItem: () => {
          throw new Error('storage unavailable');
        },
        setItem: vi.fn(),
      },
    });

    expect(getInitialLanguageChoice()).toBe('auto');
  });

  it('defaults to auto mode when no valid preference exists', () => {
    stubWindow('', 'not-a-locale');

    expect(getInitialLanguageChoice()).toBe('auto');

    stubWindow('', ' pt-BR ');

    expect(getInitialLanguageChoice()).toBe('auto');

    stubWindow('', `pt-BR${String.fromCodePoint(0x200b)}`);

    expect(getInitialLanguageChoice()).toBe('auto');
  });

  it('returns auto when URL lang param is explicitly auto', () => {
    stubWindow('?lang=auto');

    expect(getInitialLanguageChoice()).toBe('auto');
  });

  it('returns auto when stored language is explicitly auto', () => {
    stubWindow('', 'auto');

    expect(getInitialLanguageChoice()).toBe('auto');
  });

  it('persists explicit auto and locale choices', () => {
    const storage = stubWindow('');

    persistLanguageChoice('auto');
    expect(storage.get('atlasterm.web.language')).toBe('auto');

    persistLanguageChoice('zh-TW');
    expect(storage.get('atlasterm.web.language')).toBe('zh-TW');
  });

  it('keeps language changes in memory when storage writes are blocked', () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: () => {
          throw new Error('storage blocked');
        },
      },
    });

    expect(() => persistLanguageChoice('zh-TW')).not.toThrow();
  });

  it('resolves automatic mode from browser locale candidates', () => {
    vi.stubGlobal('navigator', {
      language: 'ar-SA',
      languages: ['ar-SA', 'en-US'],
    });

    expect(resolveLanguageChoice('auto')).toBe('ar');
  });

  it('returns explicit locale when choice is not auto', () => {
    expect(resolveLanguageChoice('en')).toBe('en');
    expect(resolveLanguageChoice('ja')).toBe('ja');
    expect(resolveLanguageChoice('ar')).toBe('ar');
  });

  it('applies document language and text direction', () => {
    const documentElement = { dir: '', lang: '' };
    vi.stubGlobal('document', { documentElement });

    applyDocumentLocale('ar');

    expect(documentElement).toEqual({ dir: 'rtl', lang: 'ar' });
  });

  it('uses completed Japanese local status translations', () => {
    const translator = createWebTranslator('ja');

    expect(translator.local('web.status.active')).toBe('アクティブ');
  });

  it('localizes admin data source and state panel chrome', () => {
    const translator = createWebTranslator('zh-CN');

    expect(translator.local('web.source.fixture')).toBe('演示数据回退');
    expect(translator.local('web.state.error.title')).toBe('无法加载管理快照');
    expect(translator.local('web.state.empty.message')).toBe('团队同步数据出现后会显示在这里。');
    expect(translator.local('web.state.loading.message')).toContain('团队');
  });

  it('localizes snapshot chrome across every supported non-English locale', () => {
    const chineseTranslator = createWebTranslator('zh-CN');
    const frenchTranslator = createWebTranslator('fr');

    expect(chineseTranslator.local('web.snapshot.lastRefreshed')).toBe('\u6700\u8fd1\u5237\u65b0');
    expect(chineseTranslator.local('web.snapshot.health.ready')).toBe('\u5065\u5eb7');
    expect(frenchTranslator.local('web.snapshot.lastRefreshed')).toBe('Dernière actualisation');
    expect(frenchTranslator.local('web.snapshot.health.ready')).toBe('Sain');

    for (const locale of SUPPORTED_LOCALES.map((supportedLocale) => supportedLocale.code)) {
      if (locale === 'en') continue;

      const translator = createWebTranslator(locale);
      expect(translator.local('web.snapshot.status')).not.toBe('Snapshot status');
      expect(translator.local('web.snapshot.health.ready')).not.toBe('Healthy');
    }
  });

  it('keeps web-local admin chrome free of mojibake', () => {
    for (const locale of SUPPORTED_LOCALES.map((supportedLocale) => supportedLocale.code)) {
      const translator = createWebTranslator(locale);

      for (const key of getLocalMessageKeys()) {
        expectReadableText(translator.local(key));
      }
    }
  });

  it('keeps strict Simplified Chinese admin states readable', () => {
    const translator = createWebTranslator('zh-CN');

    expect(translator.local('web.state.empty.label')).toBe('\u5feb\u7167\u4e3a\u7a7a');
    expect(translator.local('web.state.empty.title')).toBe('\u5c1a\u65e0\u7ba1\u7406\u540c\u6b65\u6570\u636e');
    expect(translator.local('web.state.empty.message')).toBe(
      '\u56e2\u961f\u540c\u6b65\u6570\u636e\u51fa\u73b0\u540e\u4f1a\u663e\u793a\u5728\u8fd9\u91cc\u3002',
    );
    expect(translator.local('web.source.fixture')).toBe('\u6f14\u793a\u6570\u636e\u56de\u9000');
    expect(translator.local('web.role.workspaceAdmin')).toBe('\u5de5\u4f5c\u533a\u7ba1\u7406\u5458');
    expect(translator.local('web.status.degraded')).toBe('\u964d\u7ea7');
    expect(translator.local('web.status.offline')).toBe('\u79bb\u7ebf');
    expect(translator.local('web.status.suspended')).toBe('\u5df2\u505c\u6743');
  });

  it('returns auto when running in SSR without window', () => {
    const originalWindow = globalThis.window;
    // simulate SSR by deleting window
    delete (globalThis as Record<string, unknown>).window;

    try {
      expect(getInitialLanguageChoice()).toBe('auto');
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('creates async translator with shared and local accessors', async () => {
    const translator = await createWebTranslatorAsync('ja');

    expect(translator.local('web.status.active')).toBe('\u30a2\u30af\u30c6\u30a3\u30d6');
    expect(typeof translator.shared).toBe('function');
  });

  it('keeps the sync translator usable when eager locale loading fails', async () => {
    vi.spyOn(i18n, 'loadLocale').mockRejectedValueOnce(new Error('locale chunk missing'));

    const translator = createWebTranslator('en');

    expect(translator.local('web.status.current')).toBe('Current');
    await Promise.resolve();
  });

  it('falls back to English shared messages when async locale loading fails', async () => {
    vi.spyOn(i18n, 'loadLocale').mockRejectedValueOnce(new Error('locale chunk missing'));

    const translator = await createWebTranslatorAsync('ja');

    expect(translator.local('web.status.active')).toBe('\u30a2\u30af\u30c6\u30a3\u30d6');
    expect(translator.shared('language.selectorLabel')).toBe('Display language');
  });

  it('async translator falls back to common messages for missing locale keys', async () => {
    const translator = await createWebTranslatorAsync('en');

    expect(translator.local('web.status.current')).toBe('Current');
  });
});
