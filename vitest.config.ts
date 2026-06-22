import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude E2E tests (run via Playwright) and mobile tests (run via
    // workspace-specific vitest 4.0.13 to avoid react-native Flow parse issues).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/e2e/**',
      '**/scripts/**/*.test.mjs',
      '**/.expo/**',
      'apps/mobile/**',
    ],
    coverage: {
      provider: 'v8',
      all: true,
      include: [
        'apps/desktop/src/**/*.{ts,tsx}',
        'apps/web/src/**/*.{ts,tsx}',
        'packages/*/src/**/*.{ts,tsx}',
      ],
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/e2e/**',
        '**/*.config.*',
        '**/*.d.ts',
        '**/types/**',
        '**/*.test.{ts,tsx}',
        '**/*.css',
        // Pure re-export barrel (no logic).
        'packages/ui/src/index.ts',
        // DOM entrypoints mount React/SW and are exercised via Playwright E2E,
        // not unit-coverable in isolation.
        'apps/desktop/src/main.tsx',
        // xterm.js renders to a canvas/DOM not exercisable headless; the wiring
        // logic lives in the fully-tested usePtySession hook.
        'apps/desktop/src/XtermTerminal.tsx',
        'apps/web/src/main.tsx',
        'apps/*/src/sw-register.ts',
      ],
    },
  },
});
