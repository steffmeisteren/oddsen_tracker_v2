import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Plus, Save, Trash2 } from 'lucide-react';
import type { BetSlip, BettingMarket, UserBet } from '../../types/domain';
import { breakEvenProbability, combinedOdds, estimatedPayout, impliedProbability } from '../../analytics';
import { downloadTextFile, exportBetSlipsCsv, exportBetSlipsJson, findCorrelations } from './betSlip';
import './betting.css';

interface BettingWorkspaceProps {
  fixtureId: string;
  markets: BettingMarket[];
  savedSlips: BetSlip[];
  onSavedSlipsChange: (slips: BetSlip[]) => void;
  userProbabilities: Record<string, number>;
  onUserProbabilitiesChange: (probabilities: Record<string, number>) => void;
}

export function BettingWorkspace({
  fixtureId, markets, savedSlips, onSavedSlipsChange, userProbabilities, onUserProbabilitiesChange,
}: BettingWorkspaceProps) {
  const [bets, setBets] = useState<UserBet[]>([]);
  const [stake, setStake] = useState(100);
  const [note, setNote] = useState('');
  const [oddsDrafts, setOddsDrafts] = useState<Record<string, string>>({});
  const correlations = useMemo(() => findCorrelations(bets), [bets]);
  const betOdds = bets.map((bet) => bet.odds);
  const totalOdds = combinedOdds(betOdds);

  function addBet(market: BettingMarket, selectionId: string) {
    const selection = market.selections.find((item) => item.id === selectionId);
    if (!selection || bets.some((bet) => bet.selectionId === selectionId)) return;
    const odds = Number(oddsDrafts[selectionId] ?? selection.odds);
    if (!Number.isFinite(odds) || odds <= 1) return;
    setBets((current) => [...current.filter((bet) => bet.marketId !== market.id), {
      id: crypto.randomUUID(), marketId: market.id, selectionId, label: `${market.name} · ${selection.label}`,
      odds, correlatedWith: [],
    }]);
  }

  function saveSlip() {
    if (!bets.length || totalOdds === null || !Number.isFinite(stake) || stake < 0) return;
    const slip: BetSlip = {
      id: crypto.randomUUID(), name: `Kupong ${savedSlips.length + 1}`, fixtureId, stake,
      bets: bets.map((bet) => ({ ...bet, correlatedWith: correlations.get(bet.id) ?? [] })), note,
      createdAt: new Date().toISOString(),
    };
    onSavedSlipsChange([slip, ...savedSlips]);
  }

  return (
    <section className="betting-workspace" aria-labelledby="markets-title">
      <div className="section-heading">
        <div><span className="eyebrow">Nøytralt analyseverktøy</span><h2 id="markets-title">Markedsoversikt & kupong</h2></div>
        <p>Verdi er et regnestykke basert på ditt estimat – ikke en anbefaling eller garanti.</p>
      </div>
      <div className="betting-layout">
        <div className="market-list">
          {markets.map((market) => (
            <details className="market-group" key={market.id} open={market.category === 'result' || market.category === 'goals'}>
              <summary><span>{market.name}</span><small>{market.selections.length} valg</small></summary>
              <div className="market-selections">
                {market.selections.map((selection) => {
                  const draft = oddsDrafts[selection.id] ?? String(selection.odds ?? '');
                  const odds = Number(draft);
                  const breakEven = breakEvenProbability(odds);
                  const ownProbability = userProbabilities[selection.id];
                  const value = breakEven && ownProbability ? ownProbability / breakEven - 1 : null;
                  return <article className="market-row" key={selection.id}>
                    <div className="market-main">
                      <strong>{selection.label}</strong>
                      <span>{selection.hits}/{selection.samples} treff · {selection.samples ? Math.round(selection.hits / selection.samples * 100) : 0}%</span>
                    </div>
                    <label>Odds<input inputMode="decimal" aria-label={`Odds for ${selection.label}`} value={draft}
                      onChange={(event) => setOddsDrafts((all) => ({ ...all, [selection.id]: event.target.value }))} /></label>
                    <label>Din %<input inputMode="decimal" aria-label={`Din sannsynlighet for ${selection.label}`}
                      value={ownProbability === undefined ? '' : Math.round(ownProbability * 1000) / 10}
                      onChange={(event) => onUserProbabilitiesChange({ ...userProbabilities, [selection.id]: Number(event.target.value) / 100 })} /></label>
                    <div className="market-value">
                      <small>Break-even {breakEven ? `${(breakEven * 100).toFixed(1)}%` : '—'}</small>
                      <strong className={value !== null && value > 0 ? 'positive' : ''}>{value === null ? 'Verdi —' : `Verdi ${(value * 100).toFixed(1)}%`}</strong>
                    </div>
                    <button className="icon-button" onClick={() => addBet(market, selection.id)} aria-label={`Legg til ${selection.label}`}><Plus size={16} /></button>
                  </article>;
                })}
              </div>
            </details>
          ))}
        </div>

        <aside className="bet-slip" aria-label="Kupongbygger">
          <div className="slip-title"><div><span className="eyebrow">Arbeidskupong</span><h3>{bets.length} valg</h3></div><button className="icon-button" onClick={() => setBets([])} aria-label="Tøm kupong"><Trash2 size={16}/></button></div>
          {bets.length === 0 ? <p className="empty-state">Legg til et marked for å begynne. Oppgitte odds lagres bare lokalt.</p> : bets.map((bet) => (
            <div className="slip-bet" key={bet.id}>
              <div><strong>{bet.label}</strong><span>Desimalodds {bet.odds.toFixed(2)}</span></div>
              <button onClick={() => setBets((all) => all.filter((item) => item.id !== bet.id))} aria-label={`Fjern ${bet.label}`}>×</button>
            </div>
          ))}
          {correlations.size > 0 && <div className="correlation-warning"><AlertTriangle size={17}/><span>Valgene kan være korrelerte. Samlet implisitt sannsynlighet antar ellers uavhengighet.</span></div>}
          <label className="full-field">Innsats (kr)<input type="number" min="0" step="10" value={stake} onChange={(event) => setStake(Number(event.target.value))}/></label>
          <label className="full-field">Notat<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Din begrunnelse…"/></label>
          <dl className="slip-totals"><div><dt>Totalodds</dt><dd>{totalOdds?.toFixed(2) ?? '—'}</dd></div><div><dt>Mulig utbetaling</dt><dd>{estimatedPayout(stake, betOdds)?.toLocaleString('nb-NO', { style: 'currency', currency: 'NOK' }) ?? '—'}</dd></div><div><dt>Implisitt sannsynlighet</dt><dd>{totalOdds ? `${(impliedProbability(betOdds)! * 100).toFixed(2)}%` : '—'}</dd></div></dl>
          <button className="primary-button" disabled={!bets.length || !Number.isFinite(stake) || stake < 0} onClick={saveSlip}><Save size={16}/> Lagre lokalt</button>
          {savedSlips.length > 0 && <div className="export-actions">
            <button onClick={() => downloadTextFile('kampinnsikt-kuponger.json', exportBetSlipsJson(savedSlips), 'application/json')}><Download size={14}/> JSON</button>
            <button onClick={() => downloadTextFile('kampinnsikt-kuponger.csv', exportBetSlipsCsv(savedSlips), 'text/csv;charset=utf-8')}><Download size={14}/> CSV</button>
          </div>}
        </aside>
      </div>
    </section>
  );
}
