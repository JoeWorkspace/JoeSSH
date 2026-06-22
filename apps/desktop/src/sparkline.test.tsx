import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  it('renders an SVG with sparkline class', () => {
    const html = renderToStaticMarkup(<Sparkline values={[10, 20, 30]} color="good" />);
    expect(html).toContain('<svg');
    expect(html).toContain('sparkline');
    expect(html).toContain('<polyline');
  });

  it('is marked aria-hidden for decorative use', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} color="info" />);
    expect(html).toContain('aria-hidden="true"');
  });

  it('maps known colors to CSS variables', () => {
    for (const color of ['good', 'info', 'warn', 'premium']) {
      const html = renderToStaticMarkup(<Sparkline values={[1, 2]} color={color} />);
      expect(html).toContain('var(--atlas-');
    }
  });

  it('falls back to muted text color for unknown color', () => {
    const html = renderToStaticMarkup(<Sparkline values={[1, 2]} color="unknown" />);
    expect(html).toContain('var(--atlas-text-muted)');
  });

  it('handles empty values array', () => {
    const html = renderToStaticMarkup(<Sparkline values={[]} color="good" />);
    expect(html).toContain('<polyline');
    expect(html).toContain('sparkline');
  });

  it('handles single value', () => {
    const html = renderToStaticMarkup(<Sparkline values={[42]} color="good" />);
    expect(html).toContain('<polyline');
  });

  it('handles all equal values (zero range)', () => {
    const html = renderToStaticMarkup(<Sparkline values={[5, 5, 5]} color="info" />);
    expect(html).toContain('<polyline');
  });

  it('generates correct number of points', () => {
    const html = renderToStaticMarkup(<Sparkline values={[10, 20, 30, 40]} color="good" />);
    // 4 values = 4 points in the polyline
    const pointsMatch = html.match(/points="([^"]+)"/);
    expect(pointsMatch).toBeTruthy();
    const points = pointsMatch?.[1]?.trim().split(' ') ?? [];
    expect(points).toHaveLength(4);
  });
});
