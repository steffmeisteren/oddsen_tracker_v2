import { ArrowDownRight, ArrowRight, ArrowUpRight, GitCompareArrows } from 'lucide-react';
import type { DataSourceMetadata, Fixture, Team, TrendMetric } from '../types/domain';
import { DataQualityBadge, EmptyState } from './Core';
import { Metric } from './ComparisonTable';

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="spark-empty" aria-label={`${label}: utilstrekkelig data`}>—</span>;
  const w=120,h=34,p=3,min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const points=values.map((v,i)=>`${p+(i*(w-p*2))/(values.length-1)},${h-p-((v-min)*(h-p*2))/range}`).join(' ');
  return <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}: ${values.join(', ')}`}><polyline points={points}/><circle cx={points.split(' ').at(-1)?.split(',')[0]} cy={points.split(' ').at(-1)?.split(',')[1]} r="2.5"/></svg>;
}
export function TrendCards({ trends }: { trends: TrendMetric[] }) {
  return <div className="trend-grid">{trends.length ? trends.map(t=><article className="trend-card" key={t.key}><header><span>{t.label}</span><DataQualityBadge quality={t.metadata.quality}/></header><div className="trend-value"><Metric value={t.current}/><TrendDirection direction={t.direction} change={t.changePercent}/></div><Sparkline values={t.values} label={t.label}/><footer><span>Snitt <Metric value={t.seasonAverage}/></span><span>Median <Metric value={t.median}/></span><span>σ <Metric value={t.stdDev}/></span></footer></article>):<EmptyState message="Ingen trendserier finnes for utvalget."/>}</div>;
}
function TrendDirection({direction,change}:{direction:TrendMetric['direction'];change:number|null}) { const Icon=direction==='up'?ArrowUpRight:direction==='down'?ArrowDownRight:ArrowRight; return <span className={`trend-direction trend-${direction}`}><Icon size={15}/>{change==null?'—':`${Math.abs(change).toLocaleString('nb-NO',{maximumFractionDigits:1})}%`}</span>; }

export interface H2HProps { fixtures: Fixture[]; homeTeam: Team; awayTeam: Team; metadata?: DataSourceMetadata; }
export function HeadToHead({fixtures,homeTeam,awayTeam,metadata}:H2HProps) {
  return <section className="panel h2h-panel"><header><span className="panel-icon"><GitCompareArrows size={18}/></span><span><small>Innbyrdes</small><h2>{homeTeam.shortName} mot {awayTeam.shortName}</h2></span>{metadata&&<DataQualityBadge quality={metadata.quality}/>}</header>{fixtures.length?<div className="h2h-list">{fixtures.map(f=><div key={f.id}><time dateTime={f.kickoff}>{new Intl.DateTimeFormat('nb-NO',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(f.kickoff))}</time><strong>{f.homeTeamId===homeTeam.id?homeTeam.shortName:awayTeam.shortName}</strong><b>{f.homeScore??'–'} : {f.awayScore??'–'}</b><strong>{f.awayTeamId===awayTeam.id?awayTeam.shortName:homeTeam.shortName}</strong></div>)}</div>:<EmptyState message="Ingen tidligere innbyrdes oppgjør er tilgjengelig."/>}</section>;
}
