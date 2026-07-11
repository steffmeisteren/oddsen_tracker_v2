export type DataQuality = 'direct' | 'calculated' | 'estimated' | 'unavailable';
export type VenueScope = 'all' | 'home' | 'away' | 'neutral';
export type MatchPeriod = 'full' | 'firstHalf' | 'secondHalf' | 'extraTime';
export type FixtureStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
export type PlayerPosition = 'GK' | 'DF' | 'MF' | 'FW';

export interface DataSourceMetadata {
  source: string;
  updatedAt: string;
  sampleSize: number;
  quality: DataQuality;
  isDemo: boolean;
  includesExtraTime: boolean;
  includesPenaltyShootouts: boolean;
  note?: string;
}

export interface Competition { id: string; name: string; country: string; currentSeasonId: string; }
export interface Season { id: string; competitionId: string; name: string; startsAt: string; endsAt: string; }
export interface Team { id: string; competitionId: string; name: string; shortName: string; code: string; color: string; position: number; }
export interface Player {
  id: string; teamId: string; name: string; position: PlayerPosition; number: number;
  expectedStatus: 'starter' | 'bench' | 'doubtful' | 'out'; startProbability?: number;
}

export type MatchEventType =
  | 'goal' | 'ownGoal' | 'penaltyGoal' | 'penaltyMiss' | 'directFreeKickGoal'
  | 'yellowCard' | 'secondYellowCard' | 'redCard' | 'substitution' | 'corner'
  | 'foul' | 'offside' | 'VAR' | 'shot' | 'shotOnTarget' | 'goalkeeperSave';

export interface MatchEvent { id: string; fixtureId: string; teamId: string; playerId?: string; type: MatchEventType; minute: number; period: MatchPeriod; detail?: string; }
export interface TeamMatchStatistics {
  fixtureId: string; teamId: string; goals: number; goalsAgainst: number; halfTimeGoals: number;
  corners: number; cornersAgainst: number; yellowCards: number; redCards: number; fouls: number;
  freeKicks: number; offsides: number; penalties: number; shots: number; shotsOnTarget: number;
  xG: number | null; possession: number | null; passAccuracy: number | null; metadata: DataSourceMetadata;
}
export interface PlayerMatchStatistics {
  fixtureId: string; playerId: string; minutes: number; goals: number; assists: number; shots: number;
  shotsOnTarget: number; xG: number | null; xA: number | null; cards: number; fouls: number;
  foulsWon: number; offsides: number; headers: number; penaltyGoals: number; freeKickGoals: number;
  cornersTaken: number; freeKicksTaken: number; metadata: DataSourceMetadata;
}
export interface Fixture {
  id: string; competitionId: string; seasonId: string; homeTeamId: string; awayTeamId: string;
  kickoff: string; stadium: string; status: FixtureStatus; refereeId?: string; homeScore?: number; awayScore?: number;
  statistics: TeamMatchStatistics[]; events: MatchEvent[];
}
export interface RefereeStatistics { id: string; name: string; cardsPerMatch: number; redsPerMatch: number; penaltiesPerMatch: number; foulsPerMatch: number; metadata: DataSourceMetadata; }

export type MarketCategory = 'result' | 'goals' | 'players' | 'corners' | 'cards' | 'other';
export interface BettingSelection {
  id: string; marketId: string; label: string; odds?: number; userProbability?: number;
  hits: number; samples: number; recentHits: number; recentSamples: number; opponentRate: number | null;
  competitionRate: number | null; metadata: DataSourceMetadata;
}
export interface BettingMarket { id: string; fixtureId: string; category: MarketCategory; name: string; selections: BettingSelection[]; }
export interface UserBet { id: string; marketId: string; selectionId: string; label: string; odds: number; correlatedWith: string[]; note?: string; }
export interface BetSlip { id: string; name: string; fixtureId: string; stake: number; bets: UserBet[]; note?: string; createdAt: string; }
export interface TrendMetric { key: string; label: string; current: number | null; seasonAverage: number | null; median: number | null; stdDev: number | null; min: number | null; max: number | null; changePercent: number | null; direction: 'up' | 'down' | 'flat' | 'unavailable'; values: number[]; metadata: DataSourceMetadata; }

export interface AnalysisFilters {
  sample: 3 | 5 | 10 | 'competition' | 'season'; venue: VenueScope; period: MatchPeriod;
  includeExtraTime: boolean; opponentLevel: 'all' | 'top' | 'middle' | 'bottom';
  result: 'all' | 'win' | 'draw' | 'loss'; from?: string; to?: string;
}

export interface MatchDetails { fixture: Fixture; homeTeam: Team; awayTeam: Team; referee?: RefereeStatistics; players: Player[]; playerStatistics: PlayerMatchStatistics[]; }
