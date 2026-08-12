import { useId } from "react";

/**
 * Hand-rolled SVG charts — no charting dependency (see vite.admin.config.ts).
 *
 * House rules, applied uniformly so a reader can compare panels at a glance:
 *   - value axes always start at zero;
 *   - no gradients, no 3-D, no decorative animation;
 *   - every chart names its unit;
 *   - a colour means the same thing on every page (SERIES order is fixed).
 *
 * Charts scale via viewBox, so the SVG text scales with the container. That is
 * the deliberate trade for not shipping a layout engine.
 */

export const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
];

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

const W = 800;
const PAD = { top: 8, right: 8, bottom: 26, left: 44 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(value));
  const scaled = value / mag;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * mag;
}

function Axis({ max, height }: { max: number; height: number }) {
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  return (
    <g>
      {ticks.map((t) => {
        const y = height - PAD.bottom - ((height - PAD.top - PAD.bottom) * t) / (max || 1);
        return (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">
              {t}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface StackedDatum {
  key: string;
  values: Record<string, number>;
}

/** Stacked bars: one bar per period, one colour per series. */
export function StackedBars({
  data,
  series,
  unitLabel,
  height = 220,
  emptyLabel = "No data yet.",
}: {
  data: StackedDatum[];
  series: string[];
  unitLabel: string;
  height?: number;
  emptyLabel?: string;
}) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted">{emptyLabel}</p>;

  const totals = data.map((d) => series.reduce((sum, s) => sum + (d.values[s] ?? 0), 0));
  const max = niceMax(Math.max(...totals, 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / data.length;
  const barW = Math.max(2, Math.min(38, slot * 0.7));

  return (
    <figure className="m-0">
      <div className="scroll-x">
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={unitLabel}>
          <Axis max={max} height={height} />
          {data.map((d, i) => {
            const x = PAD.left + slot * i + (slot - barW) / 2;
            let cursor = height - PAD.bottom;
            return (
              <g key={d.key}>
                {series.map((s, si) => {
                  const v = d.values[s] ?? 0;
                  if (v <= 0) return null;
                  const h = (plotH * v) / max;
                  cursor -= h;
                  return (
                    <rect
                      key={s}
                      x={x}
                      y={cursor}
                      width={barW}
                      height={h}
                      fill={seriesColor(si)}
                      opacity={0.9}
                    >
                      <title>{`${d.key} · ${s}: ${v}`}</title>
                    </rect>
                  );
                })}
                {/* Label every bar when there is room, else roughly six. */}
                {(data.length <= 12 || i % Math.ceil(data.length / 6) === 0) && (
                  <text
                    x={x + barW / 2}
                    y={height - PAD.bottom + 15}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--color-muted)"
                  >
                    {shortLabel(d.key)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <Legend series={series} />
      <figcaption className="mt-1 text-[11px] text-muted">{unitLabel}</figcaption>
    </figure>
  );
}

function Legend({ series }: { series: string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 p-0 text-[11px] text-muted">
      {series.map((s, i) => (
        <li key={s} className="flex list-none items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: seriesColor(i) }}
          />
          {s}
        </li>
      ))}
    </ul>
  );
}

/** Single-series line with a filled area. */
export function LineSeries({
  data,
  unitLabel,
  height = 180,
  emptyLabel = "No data yet.",
}: {
  data: { key: string; value: number }[];
  unitLabel: string;
  height?: number;
  emptyLabel?: string;
}) {
  const gradientId = useId();
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted">{emptyLabel}</p>;

  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length === 1 ? plotW / 2 : (plotW * i) / (data.length - 1));
  const y = (v: number) => height - PAD.bottom - (plotH * v) / max;

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${height - PAD.bottom} L${x(0)},${height - PAD.bottom} Z`;

  return (
    <figure className="m-0">
      <div className="scroll-x">
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={unitLabel}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-series-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Axis max={max} height={height} />
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke="var(--color-series-1)" strokeWidth={2} />
          {data.map((d, i) => (
            <circle key={d.key} cx={x(i)} cy={y(d.value)} r={2.5} fill="var(--color-series-1)">
              <title>{`${d.key}: ${d.value}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <figcaption className="mt-1 text-[11px] text-muted">{unitLabel}</figcaption>
    </figure>
  );
}

/** Horizontal category bars — the readable choice for named buckets. */
export function CategoryBars({
  data,
  unitLabel,
  max: maxOverride,
  emptyLabel = "No data yet.",
}: {
  data: { key: string; n: number }[];
  unitLabel: string;
  max?: number;
  emptyLabel?: string;
}) {
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted">{emptyLabel}</p>;
  const max = maxOverride ?? Math.max(...data.map((d) => d.n), 1);

  return (
    <div>
      <ul className="space-y-1.5 p-0">
        {data.map((d) => (
          <li key={d.key} className="list-none">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-ink">{d.key}</span>
              <span className="tnum shrink-0 text-muted">{d.n.toLocaleString("en-US")}</span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-surface-2">
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${(d.n / max) * 100}%`, background: "var(--color-series-1)" }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">{unitLabel}</p>
    </div>
  );
}

/** "2026-07-26" → "07-26"; an hour stays as-is. */
function shortLabel(key: string): string {
  return key.length === 10 ? key.slice(5) : key;
}
