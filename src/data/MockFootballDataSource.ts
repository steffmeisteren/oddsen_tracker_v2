import type { AnalysisFilters, Fixture, MatchDetails, PlayerMatchStatistics, TeamMatchStatistics } from '../types/domain';
import type { DateRange, FootballDataSource } from './FootballDataSource';
import {
  demoCompetitions,
  demoFixtures,
  demoMarkets,
  demoPlayers,
  demoPlayerStatistics,
  demoReferees,
  demoTeams,
} from './demoData';

const clone = <T>(value: T): T => structuredClone(value);

const inRange = (kickoff: string, range?: DateRange): boolean => {
  const time = Date.parse(kickoff);
  const from = range?.from ? Date.parse(range.from) : Number.NEGATIVE_INFINITY;
  const to = range?.to ? Date.parse(`${range.to}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  return Number.isFinite(time) && time >= from && time <= to;
};

const resultMatches = (fixture: Fixture, teamId: string, result: AnalysisFilters['result']): boolean => {
  if (result === 'all' || fixture.homeScore === undefined || fixture.awayScore === undefined) return result === 'all';
  const own = fixture.homeTeamId === teamId ? fixture.homeScore : fixture.awayScore;
  const opponent = fixture.homeTeamId === teamId ? fixture.awayScore : fixture.homeScore;
  return result === 'win' ? own > opponent : result === 'draw' ? own === opponent : own < opponent;
};

const opponentMatches = (fixture: Fixture, teamId: string, level: AnalysisFilters['opponentLevel']): boolean => {
  if (level === 'all') return true;
  const opponentId = fixture.homeTeamId === teamId ? fixture.awayTeamId : fixture.homeTeamId;
  const position = demoTeams.find((team) => team.id === opponentId)?.position;
  if (position === undefined) return false;
  if (level === 'top') return position <= 1;
  if (level === 'middle') return position > 1 && position < demoTeams.length;
  return position === demoTeams.length;
};

const fixturesForFilters = (teamId: string, filters: AnalysisFilters): Fixture[] => {
  const selected = demoFixtures
    .filter((fixture) => fixture.status === 'finished')
    .filter((fixture) => fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)
    .filter((fixture) => filters.venue === 'all'
      || (filters.venue === 'home' && fixture.homeTeamId === teamId)
      || (filters.venue === 'away' && fixture.awayTeamId === teamId)
      || (filters.venue === 'neutral' && false))
    .filter((fixture) => inRange(fixture.kickoff, filters))
    .filter((fixture) => resultMatches(fixture, teamId, filters.result))
    .filter((fixture) => opponentMatches(fixture, teamId, filters.opponentLevel))
    .sort((a, b) => b.kickoff.localeCompare(a.kickoff));

  const limit = typeof filters.sample === 'number' ? filters.sample : undefined;
  return limit ? selected.slice(0, limit) : selected;
};

export class MockFootballDataSource implements FootballDataSource {
  async getCompetitions() {
    return clone(demoCompetitions);
  }

  async getTeams(competitionId: string) {
    return clone(demoTeams.filter((team) => team.competitionId === competitionId));
  }

  async getFixtures(teamIds: string[], dateRange?: DateRange) {
    const wanted = new Set(teamIds);
    return clone(demoFixtures.filter((fixture) =>
      (wanted.size === 0 || wanted.has(fixture.homeTeamId) || wanted.has(fixture.awayTeamId)) && inRange(fixture.kickoff, dateRange),
    ));
  }

  async getMatchDetails(matchId: string): Promise<MatchDetails | null> {
    const fixture = demoFixtures.find((item) => item.id === matchId);
    if (!fixture) return null;
    const homeTeam = demoTeams.find((team) => team.id === fixture.homeTeamId);
    const awayTeam = demoTeams.find((team) => team.id === fixture.awayTeamId);
    if (!homeTeam || !awayTeam) return null;
    const teamIds = new Set([homeTeam.id, awayTeam.id]);
    return clone({
      fixture,
      homeTeam,
      awayTeam,
      referee: demoReferees.find((referee) => referee.id === fixture.refereeId),
      players: demoPlayers.filter((player) => teamIds.has(player.teamId)),
      playerStatistics: demoPlayerStatistics.filter((statistics) => statistics.fixtureId === matchId),
    });
  }

  async getTeamStatistics(teamId: string, filters: AnalysisFilters): Promise<TeamMatchStatistics[]> {
    // Demo-kilden har bare fulltidssummer. Tom liste hindrer at fulltidstall feilaktig
    // presenteres som periode- eller ekstraomgangsdata.
    if (filters.period !== 'full') return [];
    const fixtures = fixturesForFilters(teamId, filters);
    const statistics = fixtures.flatMap((fixture) => fixture.statistics.filter((item) => item.teamId === teamId));
    return clone(statistics);
  }

  async getPlayerStatistics(playerId: string, filters: AnalysisFilters): Promise<PlayerMatchStatistics[]> {
    if (filters.period !== 'full') return [];
    const player = demoPlayers.find((item) => item.id === playerId);
    if (!player) return [];
    const fixtureIds = new Set(fixturesForFilters(player.teamId, filters).map((fixture) => fixture.id));
    return clone(demoPlayerStatistics.filter((statistics) => statistics.playerId === playerId && fixtureIds.has(statistics.fixtureId)));
  }

  async getHeadToHead(teamAId: string, teamBId: string) {
    if (teamAId === teamBId) return [];
    return clone(demoFixtures
      .filter((fixture) => fixture.status === 'finished')
      .filter((fixture) =>
        (fixture.homeTeamId === teamAId && fixture.awayTeamId === teamBId)
        || (fixture.homeTeamId === teamBId && fixture.awayTeamId === teamAId),
      )
      .sort((a, b) => b.kickoff.localeCompare(a.kickoff)));
  }

  async getAvailableMarkets(matchId: string) {
    return clone(demoMarkets.filter((market) => market.fixtureId === matchId));
  }
}

export const mockFootballDataSource = new MockFootballDataSource();

