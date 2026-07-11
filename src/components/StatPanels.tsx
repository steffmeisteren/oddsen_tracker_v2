import { AlertTriangle, Flag, Goal, ScanLine, ShieldAlert, UserRoundX } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { DataSourceMetadata, Fixture, Team, TeamMatchStatistics } from '../types/domain';
import { DataQualityBadge, EmptyState } from './Core';
import { Metric } from './ComparisonTable';

export interface StatItem { id: string; label: string; home: number | null; away: number | null; metadata: DataSourceMetadata; format?: 'number'|'percent'; }
export interface StatPanelProps { title: string; eyebrow?: string; icon?: ReactNode; homeLabel: string; awayLabel: string; items: StatItem[]; }
export function StatPanel({ title, eyebrow, icon, homeLabel, awayLabel, items }: StatPanelProps) {
  return <section className="panel stat-panel"><header><span className="panel-icon">{icon}</span><span>{eyebrow && <small>{eyebrow}</small>}<h2>{title}</h2></span></header>{items.length ? <div className="stat-list"><div className="stat-head"><span>{homeLabel}</span><span/><span>{awayLabel}</span></div>{items.map(x => <div className="stat-row" key={x.id}><Metric value={x.home} format={x.format}/><span><b>{x.label}</b><DataQualityBadge quality={x.metadata.quality}/></span><Metric value={x.away} format={x.format}/></div>)}</div> : <EmptyState message={`Ingen ${title.toLocaleLowerCase('nb-NO')} er tilgjengelig.`}/>}</section>;
}
export function GoalsPanel(p: Omit<StatPanelProps,'title'|'icon'>) { return <StatPanel {...p} title="Mål og måltyper" icon={<Goal size={18}/>}/>; }
export function CornersPanel(p: Omit<StatPanelProps,'title'|'icon'>) { return <StatPanel {...p} title="Cornere" icon={<Flag size={18}/>}/>; }
export function CardsPanel(p: Omit<StatPanelProps,'title'|'icon'>) { return <StatPanel {...p} title="Kort og dommerprofil" icon={<ShieldAlert size={18}/>}/>; }
export function DisciplinePanel(p: Omit<StatPanelProps,'title'|'icon'>) { return <StatPanel {...p} title="Frispark, offside og straffer" icon={<UserRoundX size={18}/>}/>; }
export function ShotsPanel(p: Omit<StatPanelProps,'title'|'icon'>) { return <StatPanel {...p} title="Skuddprofil" icon={<ScanLine size={18}/>}/>; }

export interface TeamStatisticsProps { team: Team; statistics: TeamMatchStatistics; }
export function TeamStatistics({ team, statistics: s }: TeamStatisticsProps) {
  const stats: { label: string; value: number|null; suffix?: string }[] = [{label:'Mål',value:s.goals},{label:'Mål mot',value:s.goalsAgainst},{label:'xG',value:s.xG},{label:'Ballbesittelse',value:s.possession,suffix:'%'},{label:'Pasningspresisjon',value:s.passAccuracy,suffix:'%'},{label:'Skudd på mål',value:s.shotsOnTarget}];
  return <section className="panel team-statistics"><header><span className="team-crest mini" style={{'--team':team.color} as CSSProperties}>{team.code}</span><span><small>Lagprofil</small><h2>{team.name}</h2></span><DataQualityBadge quality={s.metadata.quality}/></header><div className="number-grid">{stats.map(x => <div key={x.label}><small>{x.label}</small><strong>{x.value == null ? '—' : `${new Intl.NumberFormat('nb-NO',{maximumFractionDigits:2}).format(x.value)}${x.suffix ?? ''}`}</strong></div>)}</div></section>;
}

export interface MatchByMatchProps { fixtures: Fixture[]; teamsById: Record<string, Team>; selectedTeamId: string; }
export function MatchByMatch({ fixtures, teamsById, selectedTeamId }: MatchByMatchProps) {
  return <section className="panel"><header><span className="panel-icon"><ScanLine size={18}/></span><span><small>Datagrunnlag</small><h2>Kamp for kamp</h2></span></header>{fixtures.length ? <div className="match-list">{fixtures.map(f => { const home=teamsById[f.homeTeamId], away=teamsById[f.awayTeamId]; const selectedHome=f.homeTeamId===selectedTeamId; const scored=selectedHome?f.homeScore:f.awayScore, conceded=selectedHome?f.awayScore:f.homeScore; const result=scored == null || conceded == null ? '–' : scored>conceded?'S':scored<conceded?'T':'U'; return <article key={f.id}><time dateTime={f.kickoff}>{new Intl.DateTimeFormat('nb-NO',{day:'2-digit',month:'short'}).format(new Date(f.kickoff))}</time><span><strong>{home?.shortName ?? f.homeTeamId}</strong><i>{f.homeScore ?? '–'}–{f.awayScore ?? '–'}</i><strong>{away?.shortName ?? f.awayTeamId}</strong></span><b className={`result result-${result}`}>{result}</b></article>})}</div> : <EmptyState message="Ingen kamper finnes i dette utvalget."/>}</section>;
}

export function MissingDataNotice({ title = 'Begrenset datagrunnlag', message }: { title?: string; message: string }) { return <aside className="missing-notice"><AlertTriangle size={17}/><span><strong>{title}</strong>{message}</span></aside>; }
