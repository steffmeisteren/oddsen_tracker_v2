import { describe, expect, it } from 'vitest';
import { calculateSummary, mean, median, minMax, percentChange, standardDeviation, trend, validNumbers } from './statistics';

describe('descriptive statistics', () => {
  it('filters missing and non-finite data without changing the source', () => {
    const source = [3, null, Number.NaN, 1, undefined, Number.POSITIVE_INFINITY] as const;
    expect(validNumbers(source)).toEqual([3, 1]);
    expect(source[0]).toBe(3);
  });

  it('calculates mean, odd/even median and range', () => {
    expect(mean([1, 2, 6])).toBe(3);
    expect(median([9, 1, 3])).toBe(3);
    expect(median([8, 2, 6, 4])).toBe(5);
    expect(minMax([4, -2, 8])).toEqual({ min: -2, max: 8 });
  });

  it('returns null metrics for a series with no usable observations', () => {
    expect(mean([null, undefined, Number.NaN])).toBeNull();
    expect(median([])).toBeNull();
    expect(minMax([])).toEqual({ min: null, max: null });
    expect(calculateSummary([])).toEqual({
      count: 0, mean: null, median: null, populationStdDev: null,
      sampleStdDev: null, min: null, max: null,
    });
  });

  it('distinguishes population and Bessel-corrected sample deviation', () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9], 'population')).toBe(2);
    expect(standardDeviation([1, 2, 3], 'sample')).toBe(1);
    expect(standardDeviation([4], 'population')).toBe(0);
    expect(standardDeviation([4], 'sample')).toBeNull();
  });

  it('builds a complete summary from only valid values', () => {
    expect(calculateSummary([1, 2, 3, null])).toEqual({
      count: 3, mean: 2, median: 2, populationStdDev: Math.sqrt(2 / 3),
      sampleStdDev: 1, min: 1, max: 3,
    });
  });
});

describe('change and trend', () => {
  it('calculates signed percentage change using the previous magnitude', () => {
    expect(percentChange(12, 10)).toBe(20);
    expect(percentChange(-5, -10)).toBe(50);
    expect(percentChange(1, 0)).toBeNull();
    expect(percentChange(null, 3)).toBeNull();
  });

  it('detects upward, downward and flat least-squares trends', () => {
    expect(trend([1, 2, 3])).toEqual({ slope: 1, direction: 'up', changePercent: 200 });
    expect(trend([3, 2, 1]).direction).toBe('down');
    expect(trend([2, 2, 2])).toEqual({ slope: 0, direction: 'flat', changePercent: 0 });
  });

  it('ignores missing observations and reports insufficient trends explicitly', () => {
    expect(trend([null, 2, undefined])).toEqual({ slope: null, direction: 'unavailable', changePercent: null });
    expect(trend([1, null, 3]).slope).toBe(2);
  });

  it('supports a caller-defined flat tolerance', () => {
    expect(trend([1, 1.001], 0.01).direction).toBe('flat');
    expect(trend([1, 1.001], -1).direction).toBe('up');
  });
});
