import { describe, expect, it } from 'vitest';

describe('mobile entry telemetry policy', () => {
  it('keeps telemetry default-off and versioned for Public Beta', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const layoutPath = path.resolve(__dirname, '../app/_layout.tsx');
    const content = fs.readFileSync(layoutPath, 'utf-8');

    expect(content).toContain('EXPO_PUBLIC_ATLASTERM_TELEMETRY_OPT_IN');
    expect(content).toContain('isTelemetryOptedIn');
    expect(content).toContain("messageLabel={t('mobile.error.boundary.message')}");
    expect(content).not.toContain('this.state.error.message');
    expect(content).toContain('0.1.0-beta.3');
    expect(content).not.toContain("version: '0.1.0'");
    expect(content).not.toContain('version: "0.1.0"');
  });
});
