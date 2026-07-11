import type { AnalysisFilters, BettingMarket, Competition, Fixture, MatchDetails, PlayerMatchStatistics, Team, TeamMatchStatistics } from '../types/domain';

export interface DateRange { from?: string; to?: string; }

export interface FootballDataSource {
  getCompetitions(): Promise<Competition[]>;
  getTeams(competitionId: string): Promise<Team[]>;
  getFixtures(teamIds: string[], dateRange?: DateRange): Promise<Fixture[]>;
  getMatchDetails(matchId: string): Promise<MatchDetails | null>;
  getTeamStatistics(teamId: string, filters: AnalysisFilters): Promise<TeamMatchStatistics[]>;
  getPlayerStatistics(playerId: string, filters: AnalysisFilters): Promise<PlayerMatchStatistics[]>;
  getHeadToHead(teamAId: string, teamBId: string): Promise<Fixture[]>;
  getAvailableMarkets(matchId: string): Promise<BettingMarket[]>;
}
