import type {
  BettingMarket,
  Competition,
  DataSourceMetadata,
  Fixture,
  MatchEvent,
  Player,
  PlayerMatchStatistics,
  RefereeStatistics,
  Season,
  Team,
  TeamMatchStatistics,
} from '../types/domain';

const DEMO_NOTE = 'Syntetiske demonstrasjonsdata. Tallene beskriver ikke virkelige lag, spillere eller kamper.';

export const demoMetadata = (sampleSize: number, quality: DataSourceMetadata['quality'] = 'direct'): DataSourceMetadata => ({
  source: 'Kampinnsikt demo-datasett',
  updatedAt: '2026-07-10T08:00:00.000Z',
  sampleSize,
  quality,
  isDemo: true,
  includesExtraTime: false,
  includesPenaltyShootouts: false,
  note: DEMO_NOTE,
});

export const demoCompetitions: Competition[] = [
  { id: 'demo-nordliga', name: 'Nordligaen (demo)', country: 'Norge (fiktiv)', currentSeasonId: 'demo-2026' },
];

export const demoSeasons: Season[] = [
  { id: 'demo-2026', competitionId: 'demo-nordliga', name: '2026 – demo', startsAt: '2026-03-01', endsAt: '2026-11-30' },
];

export const demoTeams: Team[] = [
  { id: 'fjordvik', competitionId: 'demo-nordliga', name: 'Fjordvik FK (demo)', shortName: 'Fjordvik', code: 'FJF', color: '#2563eb', position: 1 },
  { id: 'nordhavn', competitionId: 'demo-nordliga', name: 'Nordhavn IL (demo)', shortName: 'Nordhavn', code: 'NIL', color: '#dc2626', position: 2 },
  { id: 'solberg', competitionId: 'demo-nordliga', name: 'Solberg Sport (demo)', shortName: 'Solberg', code: 'SBS', color: '#f59e0b', position: 3 },
  { id: 'dalen', competitionId: 'demo-nordliga', name: 'Dalen FK (demo)', shortName: 'Dalen', code: 'DFK', color: '#16a34a', position: 4 },
];

const squads: Record<string, Array<[string, Player['position'], number, Player['expectedStatus'], number?]>> = {
  fjordvik: [
    ['Marius Strand (demo)', 'GK', 1, 'starter', 0.97], ['Elias Vik (demo)', 'DF', 4, 'starter', 0.91],
    ['Jonas Eide (demo)', 'MF', 8, 'starter', 0.88], ['Sander Moen (demo)', 'FW', 9, 'starter', 0.86],
    ['Noah Berg (demo)', 'FW', 17, 'bench', 0.38],
  ],
  nordhavn: [
    ['Henrik Frost (demo)', 'GK', 1, 'starter', 0.96], ['Oskar Lund (demo)', 'DF', 5, 'starter', 0.9],
    ['Isak Dahl (demo)', 'MF', 10, 'starter', 0.87], ['Lars Nymo (demo)', 'FW', 11, 'starter', 0.82],
    ['Aksel Ruud (demo)', 'MF', 18, 'doubtful', 0.42],
  ],
  solberg: [
    ['Emil Sol (demo)', 'GK', 12, 'starter', 0.94], ['Magnus Li (demo)', 'DF', 3, 'starter', 0.89],
    ['Tobias Gran (demo)', 'MF', 7, 'starter', 0.84], ['Vetle Aas (demo)', 'FW', 14, 'starter', 0.8],
    ['Jakob Hegg (demo)', 'FW', 19, 'bench', 0.33],
  ],
  dalen: [
    ['Kristian Dal (demo)', 'GK', 1, 'starter', 0.95], ['Filip Røn (demo)', 'DF', 2, 'starter', 0.88],
    ['Mathias Eng (demo)', 'MF', 6, 'starter', 0.85], ['Andreas Foss (demo)', 'FW', 9, 'starter', 0.79],
    ['Even Skog (demo)', 'DF', 15, 'out', 0],
  ],
};

export const demoPlayers: Player[] = Object.entries(squads).flatMap(([teamId, players]) =>
  players.map(([name, position, number, expectedStatus, startProbability]) => ({
    id: `${teamId}-p${number}`,
    teamId,
    name,
    position,
    number,
    expectedStatus,
    startProbability,
  })),
);

interface TeamStatSeed {
  goals: number; halfTimeGoals: number; corners: number; yellowCards: number; redCards: number;
  fouls: number; freeKicks: number; offsides: number; penalties: number; shots: number;
  shotsOnTarget: number; xG: number | null; possession: number | null; passAccuracy: number | null;
}

interface FixtureSeed {
  id: string; kickoff: string; home: string; away: string; stadium: string; refereeId: string;
  homeStats: TeamStatSeed; awayStats: TeamStatSeed;
}

const s = (
  goals: number, halfTimeGoals: number, corners: number, yellowCards: number, redCards: number,
  fouls: number, freeKicks: number, offsides: number, penalties: number, shots: number,
  shotsOnTarget: number, xG: number | null, possession: number | null, passAccuracy: number | null,
): TeamStatSeed => ({ goals, halfTimeGoals, corners, yellowCards, redCards, fouls, freeKicks, offsides, penalties, shots, shotsOnTarget, xG, possession, passAccuracy });

const fixtureSeeds: FixtureSeed[] = [
  { id: 'demo-m01', kickoff: '2026-03-07T14:00:00+01:00', home: 'fjordvik', away: 'dalen', stadium: 'Fjordparken (demo)', refereeId: 'ref-demo-1', homeStats: s(2, 1, 7, 1, 0, 9, 13, 2, 0, 15, 6, 1.72, 57, 84), awayStats: s(0, 0, 3, 2, 0, 13, 11, 1, 0, 8, 2, 0.54, 43, 76) },
  { id: 'demo-m02', kickoff: '2026-03-08T16:00:00+01:00', home: 'nordhavn', away: 'solberg', stadium: 'Havvollen (demo)', refereeId: 'ref-demo-2', homeStats: s(1, 0, 5, 3, 0, 14, 10, 3, 0, 12, 4, 1.09, 52, 81), awayStats: s(1, 1, 4, 2, 0, 10, 15, 2, 0, 10, 3, 0.91, 48, 79) },
  { id: 'demo-m03', kickoff: '2026-03-21T15:00:00+01:00', home: 'solberg', away: 'fjordvik', stadium: 'Solenga (demo)', refereeId: 'ref-demo-1', homeStats: s(1, 1, 6, 2, 0, 12, 12, 1, 0, 11, 4, 1.16, 49, 80), awayStats: s(3, 1, 5, 1, 0, 11, 13, 2, 1, 14, 7, 2.01, 51, 82) },
  { id: 'demo-m04', kickoff: '2026-03-22T18:00:00+01:00', home: 'dalen', away: 'nordhavn', stadium: 'Dal stadion (demo)', refereeId: 'ref-demo-3', homeStats: s(0, 0, 2, 4, 1, 16, 9, 2, 0, 6, 1, 0.38, 39, 72), awayStats: s(2, 1, 8, 2, 0, 9, 17, 1, 0, 17, 6, 1.84, 61, 86) },
  { id: 'demo-m05', kickoff: '2026-04-04T15:00:00+02:00', home: 'fjordvik', away: 'nordhavn', stadium: 'Fjordparken (demo)', refereeId: 'ref-demo-2', homeStats: s(2, 0, 6, 2, 0, 12, 14, 2, 0, 13, 5, 1.48, 54, 83), awayStats: s(2, 1, 5, 3, 0, 14, 13, 4, 0, 12, 5, 1.31, 46, 78) },
  { id: 'demo-m06', kickoff: '2026-04-05T17:00:00+02:00', home: 'dalen', away: 'solberg', stadium: 'Dal stadion (demo)', refereeId: 'ref-demo-1', homeStats: s(1, 0, 4, 2, 0, 10, 12, 3, 0, 9, 3, null, 45, null), awayStats: s(2, 1, 7, 1, 0, 12, 11, 1, 0, 13, 5, null, 55, null) },
  { id: 'demo-m07', kickoff: '2026-04-18T14:00:00+02:00', home: 'dalen', away: 'fjordvik', stadium: 'Dal stadion (demo)', refereeId: 'ref-demo-3', homeStats: s(1, 0, 5, 3, 0, 15, 10, 2, 0, 10, 3, 0.86, 44, 75), awayStats: s(2, 1, 6, 2, 0, 10, 16, 3, 0, 15, 6, 1.63, 56, 84) },
  { id: 'demo-m08', kickoff: '2026-04-19T16:00:00+02:00', home: 'solberg', away: 'nordhavn', stadium: 'Solenga (demo)', refereeId: 'ref-demo-2', homeStats: s(3, 2, 4, 2, 0, 11, 14, 1, 1, 14, 7, 2.12, 47, 80), awayStats: s(1, 0, 8, 3, 0, 14, 12, 2, 0, 13, 4, 1.07, 53, 82) },
  { id: 'demo-m09', kickoff: '2026-05-02T15:00:00+02:00', home: 'fjordvik', away: 'solberg', stadium: 'Fjordparken (demo)', refereeId: 'ref-demo-1', homeStats: s(1, 1, 9, 1, 0, 8, 12, 1, 0, 16, 5, 1.44, 59, 87), awayStats: s(0, 0, 2, 2, 0, 12, 9, 3, 0, 7, 2, 0.51, 41, 74) },
  { id: 'demo-m10', kickoff: '2026-05-03T18:00:00+02:00', home: 'nordhavn', away: 'dalen', stadium: 'Havvollen (demo)', refereeId: 'ref-demo-3', homeStats: s(4, 2, 10, 1, 0, 9, 13, 2, 1, 20, 10, 3.06, 64, 88), awayStats: s(1, 0, 1, 4, 0, 13, 10, 2, 0, 6, 2, 0.62, 36, 70) },
];

const teamStats = (fixtureId: string, teamId: string, own: TeamStatSeed, opponent: TeamStatSeed): TeamMatchStatistics => ({
  fixtureId, teamId, goals: own.goals, goalsAgainst: opponent.goals, halfTimeGoals: own.halfTimeGoals,
  corners: own.corners, cornersAgainst: opponent.corners, yellowCards: own.yellowCards, redCards: own.redCards,
  fouls: own.fouls, freeKicks: own.freeKicks, offsides: own.offsides, penalties: own.penalties,
  shots: own.shots, shotsOnTarget: own.shotsOnTarget, xG: own.xG, possession: own.possession,
  passAccuracy: own.passAccuracy,
  metadata: demoMetadata(1, own.xG === null || own.passAccuracy === null ? 'unavailable' : 'direct'),
});

const goalMinutes = [18, 42, 57, 76];
const eventsFor = (seed: FixtureSeed): MatchEvent[] => {
  const events: MatchEvent[] = [];
  const addGoals = (teamId: string, count: number, halfTimeCount: number, prefix: string) => {
    const scorers = demoPlayers.filter((player) => player.teamId === teamId && (player.position === 'FW' || player.position === 'MF'));
    for (let index = 0; index < count; index += 1) {
      const minute = index < halfTimeCount ? goalMinutes[index] : goalMinutes[Math.max(2, index)];
      events.push({ id: `${seed.id}-${prefix}-g${index + 1}`, fixtureId: seed.id, teamId, playerId: scorers[index % scorers.length]?.id, type: 'goal', minute, period: minute <= 45 ? 'firstHalf' : 'secondHalf', detail: 'Syntetisk demohendelse' });
    }
  };
  addGoals(seed.home, seed.homeStats.goals, seed.homeStats.halfTimeGoals, 'h');
  addGoals(seed.away, seed.awayStats.goals, seed.awayStats.halfTimeGoals, 'a');
  if (seed.homeStats.yellowCards > 0) events.push({ id: `${seed.id}-h-y1`, fixtureId: seed.id, teamId: seed.home, type: 'yellowCard', minute: 38, period: 'firstHalf', detail: 'Syntetisk demohendelse' });
  if (seed.awayStats.yellowCards > 0) events.push({ id: `${seed.id}-a-y1`, fixtureId: seed.id, teamId: seed.away, type: 'yellowCard', minute: 64, period: 'secondHalf', detail: 'Syntetisk demohendelse' });
  if (seed.homeStats.redCards > 0) events.push({ id: `${seed.id}-h-r1`, fixtureId: seed.id, teamId: seed.home, type: 'redCard', minute: 71, period: 'secondHalf', detail: 'Syntetisk demohendelse' });
  return events;
};

export const demoFixtures: Fixture[] = [
  ...fixtureSeeds.map((seed) => ({
    id: seed.id, competitionId: 'demo-nordliga', seasonId: 'demo-2026', homeTeamId: seed.home,
    awayTeamId: seed.away, kickoff: seed.kickoff, stadium: seed.stadium, status: 'finished' as const,
    refereeId: seed.refereeId, homeScore: seed.homeStats.goals, awayScore: seed.awayStats.goals,
    statistics: [teamStats(seed.id, seed.home, seed.homeStats, seed.awayStats), teamStats(seed.id, seed.away, seed.awayStats, seed.homeStats)],
    events: eventsFor(seed),
  })),
  {
    id: 'demo-next', competitionId: 'demo-nordliga', seasonId: 'demo-2026', homeTeamId: 'fjordvik',
    awayTeamId: 'nordhavn', kickoff: '2026-08-15T16:00:00+02:00', stadium: 'Fjordparken (demo)',
    status: 'scheduled', refereeId: 'ref-demo-2', statistics: [], events: [],
  },
];

export const demoReferees: RefereeStatistics[] = [
  { id: 'ref-demo-1', name: 'Ada Nord (demo)', cardsPerMatch: 3.7, redsPerMatch: 0.12, penaltiesPerMatch: 0.21, foulsPerMatch: 21.4, metadata: demoMetadata(28, 'calculated') },
  { id: 'ref-demo-2', name: 'Erik Vest (demo)', cardsPerMatch: 4.2, redsPerMatch: 0.18, penaltiesPerMatch: 0.25, foulsPerMatch: 23.1, metadata: demoMetadata(24, 'calculated') },
  { id: 'ref-demo-3', name: 'Sara Li (demo)', cardsPerMatch: 4.8, redsPerMatch: 0.23, penaltiesPerMatch: 0.19, foulsPerMatch: 25.3, metadata: demoMetadata(26, 'calculated') },
];

const finishedFixtures = demoFixtures.filter((fixture) => fixture.status === 'finished');
export const demoPlayerStatistics: PlayerMatchStatistics[] = finishedFixtures.flatMap((fixture) =>
  fixture.statistics.flatMap((statistics) => {
    const attacker = demoPlayers.find((player) => player.teamId === statistics.teamId && player.position === 'FW');
    const midfielder = demoPlayers.find((player) => player.teamId === statistics.teamId && player.position === 'MF');
    if (!attacker || !midfielder) return [];
    return [
      {
        fixtureId: fixture.id, playerId: attacker.id, minutes: 90, goals: Math.min(statistics.goals, 2),
        assists: statistics.goals > 1 ? 1 : 0, shots: Math.max(1, Math.round(statistics.shots * 0.35)),
        shotsOnTarget: Math.min(statistics.shotsOnTarget, Math.max(1, statistics.goals)),
        xG: statistics.xG === null ? null : Number((statistics.xG * 0.48).toFixed(2)), xA: statistics.xG === null ? null : 0.18,
        cards: 0, fouls: 1, foulsWon: 2, offsides: Math.min(2, statistics.offsides), headers: 1,
        penaltyGoals: statistics.penalties > 0 && statistics.goals > 0 ? 1 : 0, freeKickGoals: 0,
        cornersTaken: 0, freeKicksTaken: 1, metadata: demoMetadata(1, statistics.xG === null ? 'unavailable' : 'calculated'),
      },
      {
        fixtureId: fixture.id, playerId: midfielder.id, minutes: 84, goals: statistics.goals > 2 ? 1 : 0,
        assists: statistics.goals > 0 ? 1 : 0, shots: Math.max(1, Math.round(statistics.shots * 0.2)),
        shotsOnTarget: Math.min(2, statistics.shotsOnTarget), xG: statistics.xG === null ? null : 0.21,
        xA: statistics.xG === null ? null : Number((statistics.xG * 0.22).toFixed(2)), cards: statistics.yellowCards > 2 ? 1 : 0,
        fouls: 2, foulsWon: 1, offsides: 0, headers: 0, penaltyGoals: 0, freeKickGoals: 0,
        cornersTaken: statistics.corners, freeKicksTaken: 2, metadata: demoMetadata(1, statistics.xG === null ? 'unavailable' : 'calculated'),
      },
    ];
  }),
);

export const demoMarkets: BettingMarket[] = [
  {
    id: 'demo-next-result', fixtureId: 'demo-next', category: 'result', name: 'Kampresultat (demo)',
    selections: [
      { id: 'demo-home', marketId: 'demo-next-result', label: 'Fjordvik', odds: 1.92, hits: 4, samples: 5, recentHits: 3, recentSamples: 3, opponentRate: 0.5, competitionRate: 0.45, metadata: demoMetadata(5, 'calculated') },
      { id: 'demo-draw', marketId: 'demo-next-result', label: 'Uavgjort', odds: 3.45, hits: 1, samples: 5, recentHits: 1, recentSamples: 3, opponentRate: 0.25, competitionRate: 0.27, metadata: demoMetadata(5, 'calculated') },
      { id: 'demo-away', marketId: 'demo-next-result', label: 'Nordhavn', odds: 3.7, hits: 2, samples: 5, recentHits: 1, recentSamples: 3, opponentRate: 0.25, competitionRate: 0.28, metadata: demoMetadata(5, 'calculated') },
    ],
  },
  {
    id: 'demo-next-goals', fixtureId: 'demo-next', category: 'goals', name: 'Totalt antall mål (demo)',
    selections: [
      { id: 'demo-over25', marketId: 'demo-next-goals', label: 'Over 2,5 mål', odds: 1.86, hits: 6, samples: 10, recentHits: 3, recentSamples: 5, opponentRate: 0.6, competitionRate: 0.6, metadata: demoMetadata(10, 'calculated') },
      { id: 'demo-under25', marketId: 'demo-next-goals', label: 'Under 2,5 mål', odds: 1.94, hits: 4, samples: 10, recentHits: 2, recentSamples: 5, opponentRate: 0.4, competitionRate: 0.4, metadata: demoMetadata(10, 'calculated') },
    ],
  },
  {
    id: 'demo-next-corners', fixtureId: 'demo-next', category: 'corners', name: 'Hjørnespark (demo)',
    selections: [
      { id: 'demo-corners-over95', marketId: 'demo-next-corners', label: 'Over 9,5 hjørnespark', odds: 2.05, hits: 5, samples: 10, recentHits: 3, recentSamples: 5, opponentRate: 0.5, competitionRate: 0.5, metadata: demoMetadata(10, 'calculated') },
    ],
  },
  {
    id: 'demo-next-player', fixtureId: 'demo-next', category: 'players', name: 'Spiller (demo)',
    selections: [
      { id: 'demo-moengoal', marketId: 'demo-next-player', label: 'Sander Moen scorer', odds: 2.55, hits: 4, samples: 5, recentHits: 2, recentSamples: 3, opponentRate: null, competitionRate: null, metadata: demoMetadata(5, 'estimated') },
    ],
  },
];
