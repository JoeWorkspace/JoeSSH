import path from 'node:path';
import { defineConfig, type ViteUserConfig } from 'vitest/config';

type CoverageOptions = NonNullable<NonNullable<ViteUserConfig['test']>['coverage']>;

// The mobile workspace resolves stricter coverage types that omit `all` from the
// v8 intersection; cast keeps the (runtime-valid) config without weakening it.
const coverage = {
  all: true,
  include: ['services/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
  reporter: ['text', 'json-summary'],
  thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
  exclude: [
    '**/*.test.{ts,tsx}',
    // Type-only module (no executable code).
    'models/**',
    // Expo Router root layout: a navigation/DOM entrypoint not unit-coverable
    // in the node test env (mirrors desktop/web main.tsx exclusions).
    'app/_layout.tsx',
  ],
} as unknown as CoverageOptions;

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      '@atlasterm/i18n': path.resolve(__dirname, '../../packages/i18n/src/index.ts'),
      'react-native': path.resolve(__dirname, 'test/reactNativeMock.ts'),
      'react-native-safe-area-context': path.resolve(__dirname, 'test/reactNativeMock.ts'),
    },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    restoreMocks: true,
    setupFiles: ['./test/setup.ts'],
    coverage: coverage,
  },
});
