import { memo } from "react";

export const Sparkline = memo(function Sparkline({ values, color }: { values: readonly number[]; color: string }) {
  const series = values.length > 0 ? values : [0];
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const w = 48;
  const h = 16;
  const divisor = Math.max(series.length - 1, 1);
  const points = series
    .map((v, i) => `${(i / divisor) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  const colorMap: Record<string, string> = {
    good: "var(--atlas-green)",
    info: "var(--atlas-blue)",
    warn: "var(--atlas-amber)",
    premium: "var(--atlas-violet)",
  };

  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <polyline
        fill="none"
        stroke={colorMap[color] ?? "var(--atlas-text-muted)"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
});
