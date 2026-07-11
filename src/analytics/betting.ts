import { validNumbers, type NullableNumber } from './statistics';

export interface HitRateResult {
  hits: number;
  misses: number;
  pushes: number;
  unavailable: number;
  decisions: number;
  rate: number | null;
}

export function overUnderHitRate(
  values: readonly NullableNumber[],
  line: number,
  side: 'over' | 'under',
): HitRateResult {
  if (!Number.isFinite(line)) {
    return { hits: 0, misses: 0, pushes: 0, unavailable: values.length, decisions: 0, rate: null };
  }
  let hits = 0;
  let misses = 0;
  let pushes = 0;
  let unavailable = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      unavailable += 1;
    } else if (value === line) {
      pushes += 1;
    } else if (side === 'over' ? value > line : value < line) {
      hits += 1;
    } else {
      misses += 1;
    }
  }
  const decisions = hits + misses;
  return { hits, misses, pushes, unavailable, decisions, rate: decisions === 0 ? null : hits / decisions };
}

/** Decimal odds must be greater than 1; results are probabilities in the 0–1 range. */
export function breakEvenProbability(decimalOdds: NullableNumber): number | null {
  return typeof decimalOdds === 'number' && Number.isFinite(decimalOdds) && decimalOdds > 1
    ? 1 / decimalOdds
    : null;
}

/** Expected net value per staked unit. For example 0.1 means +10% expected value. */
export function estimatedValue(decimalOdds: NullableNumber, probability: NullableNumber): number | null {
  if (
    typeof decimalOdds !== 'number' || !Number.isFinite(decimalOdds) || decimalOdds <= 1 ||
    typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1
  ) return null;
  return probability * decimalOdds - 1;
}

export function combinedOdds(odds: readonly NullableNumber[]): number | null {
  const valid = validNumbers(odds);
  if (odds.length === 0 || valid.length !== odds.length || valid.some((odd) => odd <= 1)) return null;
  return valid.reduce((total, odd) => total * odd, 1);
}

/** Semantic alias for combinedOdds, useful when presenting the accumulator total. */
export const totalOdds = combinedOdds;

export function estimatedPayout(stake: NullableNumber, odds: readonly NullableNumber[]): number | null {
  const totalOdds = combinedOdds(odds);
  return typeof stake === 'number' && Number.isFinite(stake) && stake >= 0 && totalOdds !== null
    ? stake * totalOdds
    : null;
}

export function impliedProbability(odds: readonly NullableNumber[]): number | null {
  const totalOdds = combinedOdds(odds);
  return totalOdds === null ? null : 1 / totalOdds;
}
