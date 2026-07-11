import type {
  AnalysisFilters,
  BettingMarket,
  Competition,
  Fixture,
  MatchDetails,
  PlayerMatchStatistics,
  Team,
  TeamMatchStatistics,
} from '../../types/domain';
import type { DateRange, FootballDataSource } from '../FootballDataSource';

type JsonRecord = Record<string, unknown>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface HttpFootballDataSourceOptions {
  baseUrl: string;
  apiKey?: string;
  fetcher?: Fetcher;
}

const record = (value: unknown): JsonRecord | null => typeof value === 'object' && value !== null ? value as JsonRecord : null;
const text = (value: unknown, fallback = ''): string => typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
const number = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/**
 * Eksempeladapter for et REST-API. Den støtter både rene lister og vanlige
 * innpakninger som `{ data: [...] }` og `{ response: [...] }`, og normaliserer
 * manglende lister til tomme lister. Domeneobjektene valideres lett før de
 * slippes videre, slik at ufullstendige API-rader ikke krasjer klienten.
 */
export class HttpFootballDataSource implements FootballDataSource {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetcher: Fetcher;

  constructor(options: HttpFootballDataSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
  }

  private async request(path: string, params: Record<string, string | undefined> = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    Object.entries(params).forEach(([key, value]) => { if (value !== undefined) url.searchParams.set(key, value); });
    const response = await this.fetcher(url, { headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined });
    if (!response.ok) throw new Error(`Fotball-API svarte med HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  }

  private rows(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    const body = record(payload);
    return body ? array(body.data ?? body.response ?? body.results ?? body.items) : [];
  }

  private competition(value: unknown): Competition | null {
    const row = record(value);
    if (!row) return null;
    const id = text(row.id ?? row.competition_id);
    const name = text(row.name ?? row.league_name);
    if (!id || !name) return null;
    return { id, name, country: text(row.country ?? record(row.area)?.name, 'Ukjent'), currentSeasonId: text(row.currentSeasonId ?? row.current_season_id ?? record(row.currentSeason)?.id) };
  }

  private team(value: unknown, competitionId: string): Team | null {
    const row = record(value);
    if (!row) return null;
    const id = text(row.id ?? row.team_id);
    const name = text(row.name ?? row.team_name);
    if (!id || !name) return null;
    return { id, competitionId, name, shortName: text(row.shortName ?? row.short_name, name), code: text(row.code ?? row.tla, name.slice(0, 3).toUpperCase()), color: text(row.color, '#64748b'), position: number(row.position ?? row.rank) ?? 0 };
  }

  async getCompetitions(): Promise<Competition[]> {
    return this.rows(await this.request('/competitions')).map((row) => this.competition(row)).filter((item): item is Competition => item !== null);
  }

  async getTeams(competitionId: string): Promise<Team[]> {
    return this.rows(await this.request(`/competitions/${encodeURIComponent(competitionId)}/teams`)).map((row) => this.team(row, competitionId)).filter((item): item is Team => item !== null);
  }

  async getFixtures(teamIds: string[], dateRange?: DateRange): Promise<Fixture[]> {
    return this.rows(await this.request('/fixtures', { teams: teamIds.join(','), from: dateRange?.from, to: dateRange?.to }))
      .map((row) => this.fixture(row)).filter((item): item is Fixture => item !== null);
  }

  private fixture(value: unknown): Fixture | null {
    const row = record(value);
    if (!row) return null;
    const home = record(row.homeTeam ?? row.home_team);
    const away = record(row.awayTeam ?? row.away_team);
    const id = text(row.id ?? row.fixture_id);
    const homeTeamId = text(row.homeTeamId ?? row.home_team_id ?? home?.id);
    const awayTeamId = text(row.awayTeamId ?? row.away_team_id ?? away?.id);
    const kickoff = text(row.kickoff ?? row.utcDate ?? row.date);
    if (!id || !homeTeamId || !awayTeamId || !kickoff) return null;
    const rawStatus = text(row.status, 'scheduled').toLowerCase();
    const status: Fixture['status'] = rawStatus === 'finished' || rawStatus === 'ft' ? 'finished'
      : rawStatus === 'live' || rawStatus === 'in_play' ? 'live'
        : rawStatus === 'postponed' ? 'postponed' : rawStatus === 'cancelled' ? 'cancelled' : 'scheduled';
    return {
      id, competitionId: text(row.competitionId ?? row.competition_id ?? record(row.competition)?.id),
      seasonId: text(row.seasonId ?? row.season_id ?? record(row.season)?.id), homeTeamId, awayTeamId, kickoff,
      stadium: text(row.stadium ?? record(row.venue)?.name, 'Ukjent stadion'), status,
      refereeId: text(row.refereeId ?? row.referee_id) || undefined,
      homeScore: number(row.homeScore ?? row.home_score ?? record(row.score)?.home),
      awayScore: number(row.awayScore ?? row.away_score ?? record(row.score)?.away),
      statistics: array(row.statistics).filter((item): item is TeamMatchStatistics => record(item) !== null && Boolean(text(record(item)?.teamId))),
      events: array(row.events).filter((item): item is Fixture['events'][number] => record(item) !== null && Boolean(text(record(item)?.id))),
    };
  }

  async getMatchDetails(matchId: string): Promise<MatchDetails | null> {
    const payload = await this.request(`/fixtures/${encodeURIComponent(matchId)}`);
    const body = record(payload);
    const candidate = body?.data ?? body?.response ?? payload;
    const details = record(Array.isArray(candidate) ? candidate[0] : candidate);
    if (!details) return null;
    const fixture = this.fixture(details.fixture ?? details);
    const homeTeam = this.team(details.homeTeam ?? details.home_team, fixture?.competitionId ?? '');
    const awayTeam = this.team(details.awayTeam ?? details.away_team, fixture?.competitionId ?? '');
    if (!fixture || !homeTeam || !awayTeam) return null;
    return { fixture, homeTeam, awayTeam, players: array(details.players) as MatchDetails['players'], playerStatistics: array(details.playerStatistics ?? details.player_statistics) as PlayerMatchStatistics[] };
  }

  async getTeamStatistics(teamId: string, filters: AnalysisFilters): Promise<TeamMatchStatistics[]> {
    return this.rows(await this.request(`/teams/${encodeURIComponent(teamId)}/statistics`, this.filterParams(filters))) as TeamMatchStatistics[];
  }

  async getPlayerStatistics(playerId: string, filters: AnalysisFilters): Promise<PlayerMatchStatistics[]> {
    return this.rows(await this.request(`/players/${encodeURIComponent(playerId)}/statistics`, this.filterParams(filters))) as PlayerMatchStatistics[];
  }

  private filterParams(filters: AnalysisFilters): Record<string, string | undefined> {
    return { sample: String(filters.sample), venue: filters.venue, period: filters.period, extraTime: String(filters.includeExtraTime), opponentLevel: filters.opponentLevel, result: filters.result, from: filters.from, to: filters.to };
  }

  async getHeadToHead(teamAId: string, teamBId: string): Promise<Fixture[]> {
    return this.rows(await this.request('/fixtures/head-to-head', { teamA: teamAId, teamB: teamBId })).map((row) => this.fixture(row)).filter((item): item is Fixture => item !== null);
  }

  async getAvailableMarkets(matchId: string): Promise<BettingMarket[]> {
    return this.rows(await this.request(`/fixtures/${encodeURIComponent(matchId)}/markets`)) as BettingMarket[];
  }
}

