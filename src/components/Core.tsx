import { CalendarDays, ChevronDown, Database, Menu, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AnalysisFilters, Competition, DataQuality, MatchPeriod, Season, Team, VenueScope } from '../types/domain';

export interface HeaderProps { title?: string; subtitle?: string; onMenu?: () => void; }
export function Header({ title = 'Kampinnsikt', subtitle = 'Førkampanalyse', onMenu }: HeaderProps) {
  return <header className="app-header">
    <button className="icon-button mobile-only" onClick={onMenu} aria-label="Åpne meny"><Menu size={20}/></button>
    <a className="brand" href="#top" aria-label="Kampinnsikt, til toppen"><span className="brand-mark">KI</span><span><strong>{title}</strong><small>{subtitle}</small></span></a>
    <div className="header-status"><span className="live-dot" aria-hidden="true"/> Analysebord <kbd>⌘ K</kbd></div>
  </header>;
}

interface SelectBoxProps { label: string; value: string; onChange: (value: string) => void; children: ReactNode; }
function SelectBox({ label, value, onChange, children }: SelectBoxProps) {
  return <label className="select-field"><span>{label}</span><span className="select-control"><select value={value} onChange={e => onChange(e.target.value)}>{children}</select><ChevronDown size={14}/></span></label>;
}

export interface SelectionBarProps {
  competitions: Competition[]; seasons: Season[]; teams: Team[];
  competitionId: string; seasonId: string; homeTeamId: string; awayTeamId: string;
  onCompetitionChange: (id: string) => void; onSeasonChange: (id: string) => void;
  onHomeTeamChange: (id: string) => void; onAwayTeamChange: (id: string) => void;
}
export function SelectionBar(p: SelectionBarProps) {
  return <section className="selection-bar" aria-label="Velg kampgrunnlag">
    <SelectBox label="Turnering" value={p.competitionId} onChange={p.onCompetitionChange}>{p.competitions.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectBox>
    <SelectBox label="Sesong" value={p.seasonId} onChange={p.onSeasonChange}>{p.seasons.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectBox>
    <SelectBox label="Hjemmelag" value={p.homeTeamId} onChange={p.onHomeTeamChange}>{p.teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectBox>
    <span className="versus" aria-hidden="true">vs</span>
    <SelectBox label="Bortelag" value={p.awayTeamId} onChange={p.onAwayTeamChange}>{p.teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectBox>
  </section>;
}

export interface FilterPanelProps { value: AnalysisFilters; onChange: (filters: AnalysisFilters) => void; }
export function FilterPanel({ value, onChange }: FilterPanelProps) {
  const set = <K extends keyof AnalysisFilters>(key: K, next: AnalysisFilters[K]) => onChange({ ...value, [key]: next });
  return <details className="filter-panel" open>
    <summary><span><SlidersHorizontal size={17}/> Utvalg og filtre</span><span className="summary-hint">Finjuster datagrunnlaget</span></summary>
    <div className="filter-grid">
      <label><span>Kamputvalg</span><select value={value.sample} onChange={e => set('sample', isNaN(Number(e.target.value)) ? e.target.value as AnalysisFilters['sample'] : Number(e.target.value) as 3|5|10)}><option value={3}>Siste 3</option><option value={5}>Siste 5</option><option value={10}>Siste 10</option><option value="competition">Turneringen</option><option value="season">Sesongen</option></select></label>
      <label><span>Arena</span><select value={value.venue} onChange={e => set('venue', e.target.value as VenueScope)}><option value="all">Alle</option><option value="home">Hjemme</option><option value="away">Borte</option><option value="neutral">Nøytral</option></select></label>
      <label><span>Periode</span><select value={value.period} onChange={e => set('period', e.target.value as MatchPeriod)}><option value="full">Hele kampen</option><option value="firstHalf">1. omgang</option><option value="secondHalf">2. omgang</option><option value="extraTime">Ekstraomganger</option></select></label>
      <label><span>Motstand</span><select value={value.opponentLevel} onChange={e => set('opponentLevel', e.target.value as AnalysisFilters['opponentLevel'])}><option value="all">Alle nivåer</option><option value="top">Topplag</option><option value="middle">Midtsjikt</option><option value="bottom">Bunnlag</option></select></label>
      <label><span>Resultat</span><select value={value.result} onChange={e => set('result', e.target.value as AnalysisFilters['result'])}><option value="all">Alle</option><option value="win">Seier</option><option value="draw">Uavgjort</option><option value="loss">Tap</option></select></label>
      <label><span><CalendarDays size={13}/> Fra</span><input type="date" value={value.from ?? ''} onChange={e => set('from', e.target.value || undefined)}/></label>
      <label><span><CalendarDays size={13}/> Til</span><input type="date" value={value.to ?? ''} onChange={e => set('to', e.target.value || undefined)}/></label>
      <label className="check-field"><input type="checkbox" checked={value.includeExtraTime} onChange={e => set('includeExtraTime', e.target.checked)}/><span>Inkluder ekstraomganger</span></label>
    </div>
  </details>;
}

export interface TabsProps { tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void; label?: string; }
export function Tabs({ tabs, active, onChange, label = 'Analyseområder' }: TabsProps) {
  return <div className="tabs" role="tablist" aria-label={label}>{tabs.map(tab => <button key={tab.id} role="tab" aria-selected={active === tab.id} onClick={() => onChange(tab.id)}>{tab.label}{tab.count !== undefined && <span>{tab.count}</span>}</button>)}</div>;
}

const qualityLabel: Record<DataQuality, string> = { direct: 'Direkte', calculated: 'Beregnet', estimated: 'Estimert', unavailable: 'Mangler' };
export function DataQualityBadge({ quality, label }: { quality: DataQuality; label?: string }) {
  return <span className={`quality-badge quality-${quality}`} title={`Datakvalitet: ${qualityLabel[quality]}`}><Database size={11}/>{label ?? qualityLabel[quality]}</span>;
}

export function EmptyState({ title = 'Data mangler', message }: { title?: string; message: string }) {
  return <div className="empty-state" role="status"><Database size={22}/><strong>{title}</strong><p>{message}</p></div>;
}
