import { expect, type Locator, type Page } from '@playwright/test';

export const commonMarketLocales = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja-JP',
  'ko-KR',
  'de-DE',
  'fr-FR',
  'es-ES',
  'pt-BR',
  'ru-RU',
  'id-ID',
  'vi-VN',
  'th-TH',
  'hi-IN',
  'ar-SA',
] as const;

export const expectedAtlasLocaleByMarketLocale: Record<(typeof commonMarketLocales)[number], string> = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'en-US': 'en',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'de-DE': 'de',
  'fr-FR': 'fr',
  'es-ES': 'es',
  'pt-BR': 'pt-BR',
  'ru-RU': 'ru',
  'id-ID': 'id',
  'vi-VN': 'vi',
  'th-TH': 'th',
  'hi-IN': 'hi',
  'ar-SA': 'ar',
};

export const expectedTextDirectionByMarketLocale: Record<(typeof commonMarketLocales)[number], 'ltr' | 'rtl'> = {
  'zh-CN': 'ltr',
  'zh-TW': 'ltr',
  'en-US': 'ltr',
  'ja-JP': 'ltr',
  'ko-KR': 'ltr',
  'de-DE': 'ltr',
  'fr-FR': 'ltr',
  'es-ES': 'ltr',
  'pt-BR': 'ltr',
  'ru-RU': 'ltr',
  'id-ID': 'ltr',
  'vi-VN': 'ltr',
  'th-TH': 'ltr',
  'hi-IN': 'ltr',
  'ar-SA': 'rtl',
};

function escapeForRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function oneOf(...values: string[]) {
  return new RegExp(values.map(escapeForRegex).join('|'), 'i');
}

export async function expectVisibleText(page: Page, ...values: string[]) {
  await expect(page.getByText(oneOf(...values)).first()).toBeVisible();
}

export async function expectContainsText(locator: Locator, ...values: string[]) {
  await expect(locator).toContainText(oneOf(...values));
}

export async function expectNoDocumentOverflow(page: Page) {
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(() => {
            const root = document.documentElement;
            const body = document.body;
            const clientWidth = root.clientWidth;
            const rootScrollWidth = root.scrollWidth;
            const bodyScrollWidth = body?.scrollWidth ?? 0;
            const scrollWidth = Math.max(rootScrollWidth, bodyScrollWidth);
            const overflow = scrollWidth - clientWidth;

            return overflow <= 1
              ? 'ok'
              : `overflow=${overflow}; scrollWidth=${scrollWidth}; clientWidth=${clientWidth}; rootScrollWidth=${rootScrollWidth}; bodyScrollWidth=${bodyScrollWidth}`;
          });
        } catch (error) {
          if (isTransientEvaluationError(error)) {
            return 'navigation in progress';
          }
          throw error;
        }
      },
      { timeout: 10_000 },
    )
    .toBe('ok');
}

function isTransientEvaluationError(error: unknown) {
  return error instanceof Error && /Execution context was destroyed|Cannot find context with specified id/.test(error.message);
}
