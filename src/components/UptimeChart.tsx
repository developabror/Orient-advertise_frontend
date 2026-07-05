import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from 'chart.js';
import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { useTranslation } from 'react-i18next';
import type { UptimeRow } from '@hooks/useUptimeReport';
import { useTheme } from '@hooks/useTheme';
import { type ResolvedTheme } from '@/theme/theme';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface Props {
  rows: readonly UptimeRow[];
}

interface ChartPalette {
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly tooltipBg: string;
  readonly tooltipText: string;
  readonly axis: string;
  readonly grid: string;
}

// A <canvas> can't read CSS variables, so sample the resolved theme tokens off
// <html> instead. `_theme` only keys the memo (its identity changes on toggle);
// the actual values come from the live custom properties, falling back to the
// original light hexes when computed styles aren't available (e.g. jsdom).
const readChartPalette = (_theme: ResolvedTheme): ChartPalette => {
  const fallback: ChartPalette = {
    success: '#1b8757',
    warning: '#f59e0b',
    danger: '#d1383a',
    tooltipBg: '#1b2540',
    tooltipText: '#ffffff',
    axis: '#4b5567',
    grid: '#eef0f4',
  };
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb;
  return {
    success: read('--oa-success', fallback.success),
    warning: read('--oa-warning', fallback.warning),
    danger: read('--oa-danger', fallback.danger),
    tooltipBg: read('--oa-accent', fallback.tooltipBg),
    tooltipText: read('--oa-on-accent', fallback.tooltipText),
    axis: read('--oa-text-secondary', fallback.axis),
    grid: read('--oa-track', fallback.grid),
  };
};

const formatLabel = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  });
};

export const UptimeChart = ({ rows }: Props) => {
  const { resolved } = useTheme();
  const { t } = useTranslation();
  const palette = useMemo(() => readChartPalette(resolved), [resolved]);

  const data: ChartData<'bar'> = useMemo(() => {
    const colorFor = (pct: number): string =>
      pct >= 95 ? palette.success : pct >= 80 ? palette.warning : palette.danger;
    return {
      labels: rows.map((r) => formatLabel(r.date)),
      datasets: [
        {
          label: t('uptimeChart.onlinePercent'),
          data: rows.map((r) => r.percent),
          backgroundColor: rows.map((r) => colorFor(r.percent)),
          borderRadius: 4,
          borderSkipped: false,
          // Cap bar width so a single-day range doesn't render one giant bar
          // spanning the chart, and so dense ranges don't go too thin.
          maxBarThickness: 56,
          minBarLength: 1,
          categoryPercentage: 0.8,
          barPercentage: 0.85,
        },
      ],
    };
  }, [rows, palette, t]);

  const options: ChartOptions<'bar'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: palette.tooltipBg,
          titleColor: palette.tooltipText,
          bodyColor: palette.tooltipText,
          padding: 10,
          displayColors: false,
          callbacks: {
            title: (items: readonly TooltipItem<'bar'>[]) => {
              const idx = items[0]?.dataIndex ?? -1;
              const row = rows[idx];
              return row ? formatLabel(row.date) : '';
            },
            label: (item: TooltipItem<'bar'>) => {
              const row = rows[item.dataIndex];
              if (!row) return '';
              const pct = `${row.percent.toFixed(1)}%`;
              const counts = t('uptimeChart.deviceCount', {
                online: row.online,
                total: row.total,
                count: row.total,
              });
              return t('uptimeChart.tooltipLabel', { pct, counts });
            },
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          // Slight visual headroom keeps a 100% bar from butting against the
          // chart's top edge without changing the labeled 100 tick.
          grace: '4%',
          ticks: {
            stepSize: 20,
            callback: (v) => `${String(v)}%`,
            color: palette.axis,
          },
          grid: { color: palette.grid },
        },
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 12,
            color: palette.axis,
          },
          grid: { display: false },
        },
      },
    }),
    [rows, palette, t],
  );

  return (
    <div className="oa-uptime-chart" role="img" aria-label={t('uptimeChart.ariaLabel')}>
      <Bar data={data} options={options} />
    </div>
  );
};
