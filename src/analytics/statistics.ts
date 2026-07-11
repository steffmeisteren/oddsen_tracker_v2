export type NullableNumber = number | null | undefined;

export interface StatisticalSummary {
  count: number;
  mean: number | null;
  median: number | null;
  populationStdDev: number | null;
  sampleStdDev: number | null;
  min: number | null;
  max: number | null;
}

export interface TrendResult {
  slope: number | null;
  direction: 'up' | 'down' | 'flat' | 'unavailable';
  changePercent: number | null;
}

/** Removes missing and non-finite observations without mutating the input. */
export function validNumbers(values: readonly NullableNumber[]): number[] {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

export function mean(values: readonly NullableNumber[]): number | null {
  const valid = validNumbers(values);
  return valid.length === 0 ? null : valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export function median(values: readonly NullableNumber[]): number | null {
  const valid = validNumbers(values).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? (valid[middle - 1] + valid[middle]) / 2 : valid[middle];
}

/**
 * Population deviation divides by N. Sample deviation uses Bessel's correction
 * (N - 1) and is therefore unavailable for fewer than two observations.
 */
export function standardDeviation(
  values: readonly NullableNumber[],
  mode: 'population' | 'sample' = 'population',
): number | null {
  const valid = validNumbers(values);
  const minimumCount = mode === 'sample' ? 2 : 1;
  if (valid.length < minimumCount) return null;
  const average = mean(valid) as number;
  const squaredDifferenceSum = valid.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return Math.sqrt(squaredDifferenceSum / (mode === 'sample' ? valid.length - 1 : valid.length));
}

export function minMax(values: readonly NullableNumber[]): { min: number | null; max: number | null } {
  const valid = validNumbers(values);
  return valid.length === 0 ? { min: null, max: null } : { min: Math.min(...valid), max: Math.max(...valid) };
}

export function calculateSummary(values: readonly NullableNumber[]): StatisticalSummary {
  const valid = validNumbers(values);
  const range = minMax(valid);
  return {
    count: valid.length,
    mean: mean(valid),
    median: median(valid),
    populationStdDev: standardDeviation(valid, 'population'),
    sampleStdDev: standardDeviation(valid, 'sample'),
    ...range,
  };
}

/** Returns null when the previous value is zero because percentage change has no finite denominator. */
export function percentChange(current: NullableNumber, previous: NullableNumber): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (((current as number) - (previous as number)) / Math.abs(previous as number)) * 100;
}

/** Least-squares trend over the valid observations in their original order. */
export function trend(values: readonly NullableNumber[], flatTolerance = 1e-9): TrendResult {
  const valid = validNumbers(values);
  if (valid.length < 2) return { slope: null, direction: 'unavailable', changePercent: null };
  const xMean = (valid.length - 1) / 2;
  const yMean = mean(valid) as number;
  let numerator = 0;
  let denominator = 0;
  valid.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  const slope = numerator / denominator;
  const tolerance = Math.max(0, flatTolerance);
  const direction = Math.abs(slope) <= tolerance ? 'flat' : slope > 0 ? 'up' : 'down';
  return { slope, direction, changePercent: percentChange(valid.at(-1), valid[0]) };
}
