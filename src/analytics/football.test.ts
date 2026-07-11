import { describe, expect, it } from 'vitest';
import { aggregateMatchResults } from './football';

describe('aggregateMatchResults', () => {
  it('aggregates W-D-L, points, goals and common match indicators', () => {
    expect(aggregateMatchResults([
      { goalsFor: 2, goalsAgainst: 0 },
      { goalsFor: 1, goalsAgainst: 1 },
      { goalsFor: 1, goalsAgainst: 3 },
    ])).toEqual({
      supplied: 3, completed: 3, unavailable: 0,
      wins: 1, draws: 1, losses: 1, points: 4, pointsPerMatch: 4 / 3,
      goalsFor: 4, goalsAgainst: 4, averageGoalsFor: 4 / 3, averageGoalsAgainst: 4 / 3,
      cleanSheets: 1, bothTeamsScored: 2, overTwoPointFive: 1,
    });
  });

  it('excludes missing, negative and fractional scores explicitly', () => {
    const result = aggregateMatchResults([
      { goalsFor: null, goalsAgainst: 0 },
      { goalsFor: 1, goalsAgainst: Number.NaN },
      { goalsFor: -1, goalsAgainst: 0 },
      { goalsFor: 1.5, goalsAgainst: 0 },
      { goalsFor: 0, goalsAgainst: 0 },
    ]);
    expect(result).toMatchObject({ supplied: 5, completed: 1, unavailable: 4, draws: 1 });
  });

  it('returns null averages when no completed score exists', () => {
    expect(aggregateMatchResults([])).toEqual({
      supplied: 0, completed: 0, unavailable: 0,
      wins: 0, draws: 0, losses: 0, points: 0, pointsPerMatch: null,
      goalsFor: 0, goalsAgainst: 0, averageGoalsFor: null, averageGoalsAgainst: null,
      cleanSheets: 0, bothTeamsScored: 0, overTwoPointFive: 0,
    });
  });
});
