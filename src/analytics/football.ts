import { mean, type NullableNumber } from './statistics';

export interface MatchScoreInput {
  goalsFor: NullableNumber;
  goalsAgainst: NullableNumber;
}

export interface MatchResultAggregate {
  supplied: number;
  completed: number;
  unavailable: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  pointsPerMatch: number | null;
  goalsFor: number;
  goalsAgainst: number;
  averageGoalsFor: number | null;
  averageGoalsAgainst: number | null;
  cleanSheets: number;
  bothTeamsScored: number;
  overTwoPointFive: number;
}

function isScore(value: NullableNumber): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function aggregateMatchResults(matches: readonly MatchScoreInput[]): MatchResultAggregate {
  const completed = matches.filter(
    (match): match is { goalsFor: number; goalsAgainst: number } => isScore(match.goalsFor) && isScore(match.goalsAgainst),
  );
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let cleanSheets = 0;
  let bothTeamsScored = 0;
  let overTwoPointFive = 0;
  for (const match of completed) {
    if (match.goalsFor > match.goalsAgainst) wins += 1;
    else if (match.goalsFor === match.goalsAgainst) draws += 1;
    else losses += 1;
    if (match.goalsAgainst === 0) cleanSheets += 1;
    if (match.goalsFor > 0 && match.goalsAgainst > 0) bothTeamsScored += 1;
    if (match.goalsFor + match.goalsAgainst > 2.5) overTwoPointFive += 1;
  }
  const goalsFor = completed.reduce((sum, match) => sum + match.goalsFor, 0);
  const goalsAgainst = completed.reduce((sum, match) => sum + match.goalsAgainst, 0);
  const points = wins * 3 + draws;
  return {
    supplied: matches.length,
    completed: completed.length,
    unavailable: matches.length - completed.length,
    wins,
    draws,
    losses,
    points,
    pointsPerMatch: completed.length ? points / completed.length : null,
    goalsFor,
    goalsAgainst,
    averageGoalsFor: mean(completed.map((match) => match.goalsFor)),
    averageGoalsAgainst: mean(completed.map((match) => match.goalsAgainst)),
    cleanSheets,
    bothTeamsScored,
    overTwoPointFive,
  };
}
