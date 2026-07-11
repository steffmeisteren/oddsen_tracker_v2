import { percentChange, type NullableNumber } from './statistics';

export interface ComparisonMetricInput {
  key: string;
  label: string;
  home: NullableNumber;
  away: NullableNumber;
  higherIsBetter?: boolean;
}

export interface ComparisonRow {
  key: string;
  label: string;
  home: number | null;
  away: number | null;
  difference: number | null;
  relativeDifferencePercent: number | null;
  leader: 'home' | 'away' | 'equal' | 'unavailable';
}

function finiteOrNull(value: NullableNumber): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function buildComparisonRows(metrics: readonly ComparisonMetricInput[]): ComparisonRow[] {
  return metrics.map((metric) => {
    const home = finiteOrNull(metric.home);
    const away = finiteOrNull(metric.away);
    if (home === null || away === null) {
      return { key: metric.key, label: metric.label, home, away, difference: null, relativeDifferencePercent: null, leader: 'unavailable' };
    }
    const difference = home - away;
    const higherIsBetter = metric.higherIsBetter ?? true;
    const leader = difference === 0 ? 'equal' : (difference > 0) === higherIsBetter ? 'home' : 'away';
    return {
      key: metric.key,
      label: metric.label,
      home,
      away,
      difference,
      relativeDifferencePercent: percentChange(home, away),
      leader,
    };
  });
}
