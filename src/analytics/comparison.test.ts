import { describe, expect, it } from 'vitest';
import { buildComparisonRows } from './comparison';

describe('buildComparisonRows', () => {
  it('calculates differences and chooses the leader', () => {
    expect(buildComparisonRows([
      { key: 'goals', label: 'Mål', home: 2, away: 1 },
      { key: 'cards', label: 'Kort', home: 1, away: 2, higherIsBetter: false },
      { key: 'draw', label: 'Lik', home: 4, away: 4 },
    ])).toEqual([
      { key: 'goals', label: 'Mål', home: 2, away: 1, difference: 1, relativeDifferencePercent: 100, leader: 'home' },
      { key: 'cards', label: 'Kort', home: 1, away: 2, difference: -1, relativeDifferencePercent: -50, leader: 'home' },
      { key: 'draw', label: 'Lik', home: 4, away: 4, difference: 0, relativeDifferencePercent: 0, leader: 'equal' },
    ]);
  });

  it('preserves usable values but refuses to infer a comparison from missing data', () => {
    expect(buildComparisonRows([{ key: 'xg', label: 'xG', home: null, away: 1.2 }])[0]).toEqual({
      key: 'xg', label: 'xG', home: null, away: 1.2,
      difference: null, relativeDifferencePercent: null, leader: 'unavailable',
    });
  });

  it('keeps percentage difference unavailable when the away baseline is zero', () => {
    expect(buildComparisonRows([{ key: 'a', label: 'A', home: 1, away: 0 }])[0]).toMatchObject({
      difference: 1, relativeDifferencePercent: null, leader: 'home',
    });
  });
});
