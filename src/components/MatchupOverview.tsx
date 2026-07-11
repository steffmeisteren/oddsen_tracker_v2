import { Clock3, MapPin, Shield, Trophy } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Fixture, RefereeStatistics, Team } from '../types/domain';
import { DataQualityBadge } from './Core';

export interface MatchupOverviewProps { fixture: Fixture; homeTeam: Team; awayTeam: Team; referee?: RefereeStatistics; locale?: string; timeZone?: string; }
export function MatchupOverview({ fixture, homeTeam, awayTeam, referee, locale = 'nb-NO', timeZone = 'Europe/Oslo' }: MatchupOverviewProps) {
  const kickoff = new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(fixture.kickoff));
  return <section className="matchup-card" aria-labelledby="match-title">
    <div className="match-meta"><span><Trophy size={14}/> Kampforhåndsvisning</span><span className={`status status-${fixture.status}`}>{fixture.status}</span></div>
    <div className="matchup-grid">
      <TeamIdentity team={homeTeam} side="Hjemme" />
      <div className="kickoff"><span id="match-title">{homeTeam.shortName} — {awayTeam.shortName}</span><strong>{fixture.homeScore ?? '–'}<i>:</i>{fixture.awayScore ?? '–'}</strong><small><Clock3 size={13}/>{kickoff}</small></div>
      <TeamIdentity team={awayTeam} side="Borte" reverse />
    </div>
    <footer className="match-footer"><span><MapPin size={14}/>{fixture.stadium}</span>{referee && <span><Shield size={14}/>Dommer: {referee.name}<DataQualityBadge quality={referee.metadata.quality}/></span>}</footer>
  </section>;
}

function TeamIdentity({ team, side, reverse }: { team: Team; side: string; reverse?: boolean }) {
  return <div className={`team-identity ${reverse ? 'reverse' : ''}`}><span className="team-crest" style={{ '--team': team.color } as CSSProperties}>{team.code.slice(0, 3)}</span><span><small>{side} · #{team.position}</small><strong>{team.name}</strong></span></div>;
}
