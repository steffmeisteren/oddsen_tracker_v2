import { describe, expect, it } from 'vitest';
import { breakEvenProbability, combinedOdds, estimatedPayout, estimatedValue, impliedProbability, overUnderHitRate } from './betting';

describe('over/under hit rate', () => {
  it('separates hits, misses, pushes and missing data', () => {
    expect(overUnderHitRate([3, 2.5, 2, null, Number.NaN], 2.5, 'over')).toEqual({
      hits: 1, misses: 1, pushes: 1, unavailable: 2, decisions: 2, rate: 0.5,
    });
    expect(overUnderHitRate([3, 2.5, 2], 2.5, 'under')).toMatchObject({ hits: 1, misses: 1, pushes: 1, rate: 0.5 });
  });

  it('does not count pushes in the hit-rate denominator', () => {
    expect(overUnderHitRate([2, 2], 2, 'over').rate).toBeNull();
  });

  it('marks every observation unavailable for an invalid line', () => {
    expect(overUnderHitRate([1, null], Number.NaN, 'over')).toEqual({
      hits: 0, misses: 0, pushes: 0, unavailable: 2, decisions: 0, rate: null,
    });
  });
});

describe('betting calculations', () => {
  it('calculates break-even and expected net value', () => {
    expect(breakEvenProbability(2)).toBe(0.5);
    expect(estimatedValue(2.5, 0.5)).toBe(0.25);
    expect(estimatedValue(2, 0.4)).toBeCloseTo(-0.2);
  });

  it.each([null, undefined, 1, 0, -2, Number.NaN])('rejects invalid decimal odds %s', (odds) => {
    expect(breakEvenProbability(odds)).toBeNull();
    expect(estimatedValue(odds, 0.5)).toBeNull();
  });

  it('rejects probabilities outside the 0–1 interval', () => {
    expect(estimatedValue(2, -0.1)).toBeNull();
    expect(estimatedValue(2, 1.1)).toBeNull();
    expect(estimatedValue(2, null)).toBeNull();
  });

  it('calculates accumulator odds, payout and implied probability', () => {
    expect(combinedOdds([2, 1.5, 2])).toBe(6);
    expect(estimatedPayout(100, [2, 1.5, 2])).toBe(600);
    expect(impliedProbability([2, 1.5, 2])).toBeCloseTo(1 / 6);
    expect(estimatedPayout(0, [2])).toBe(0);
  });

  it('rejects empty, incomplete or invalid accumulators and stakes', () => {
    expect(combinedOdds([])).toBeNull();
    expect(combinedOdds([2, null])).toBeNull();
    expect(combinedOdds([2, 1])).toBeNull();
    expect(estimatedPayout(-1, [2])).toBeNull();
    expect(impliedProbability([Number.POSITIVE_INFINITY])).toBeNull();
  });
});
