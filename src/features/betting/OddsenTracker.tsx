import { useEffect, useMemo, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import {
  ArrowDownToLine, GripVertical, Moon, Plus, RotateCcw, Sun, Trash2, Trophy, X,
} from 'lucide-react';
import './oddsen-tracker.css';

type Theme = 'dark' | 'light';
type Category = 'Kamp' | 'Spiller' | 'Timing' | 'Resultat';

interface TrackedBet {
  id: string;
  category: Category;
  market: string;
  selection: string;
  odds: number;
  stake: number;
}

const INITIAL_BETS: TrackedBet[] = [
  { id: 'over-35', category: 'Kamp', market: 'Totalt antall mål', selection: 'Over 3,5 mål', odds: 2.1, stake: 50 },
  { id: 'belgium-comeback', category: 'Kamp', market: 'Belgia vinner etter å ha ligget under', selection: 'Ja', odds: 14.5, stake: 100 },
  { id: 'first-goal', category: 'Timing', market: 'Tidspunkt for første mål', selection: 'Fra og med 76. minutt', odds: 11.5, stake: 100 },
  { id: 'over-95', category: 'Kamp', market: 'Totalt antall mål', selection: 'Over 9,5 mål', odds: 1.85, stake: 300 },
  { id: 'both-score', category: 'Kamp', market: 'Begge lag scorer', selection: 'Spania og under 2,5 mål', odds: 4.2, stake: 300 },
  { id: 'belgium-half', category: 'Resultat', market: 'Belgia vinner minst én omgang', selection: 'Ja', odds: 2.85, stake: 100 },
  { id: 'morata', category: 'Spiller', market: 'Målscorer', selection: 'Álvaro Morata scorer', odds: 6.25, stake: 100 },
];

const CATEGORIES: Array<'Alle' | Category> = ['Alle', 'Kamp', 'Spiller', 'Timing', 'Resultat'];
const categoryCode: Record<Category, string> = { Kamp: 'K', Spiller: 'SP', Timing: 'TID', Resultat: '1X2' };
const categoryClass: Record<Category, string> = { Kamp: 'match', Spiller: 'player', Timing: 'timing', Resultat: 'result' };
const money = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });

function readStoredBets() {
  try {
    const stored = localStorage.getItem('oddsen-tracker:bets');
    return stored ? JSON.parse(stored) as TrackedBet[] : INITIAL_BETS;
  } catch {
    return INITIAL_BETS;
  }
}

export function OddsenTracker() {
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('oddsen-tracker:theme') === 'light' ? 'light' : 'dark');
  const [bets, setBets] = useState<TrackedBet[]>(readStoredBets);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<'Alle' | Category>('Alle');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    localStorage.setItem('oddsen-tracker:theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('oddsen-tracker:bets', JSON.stringify(bets));
  }, [bets]);

  const visibleBets = filter === 'Alle' ? bets : bets.filter((bet) => bet.category === filter);
  const totals = useMemo(() => bets.reduce((all, bet) => ({
    stake: all.stake + bet.stake,
    payout: all.payout + bet.stake * bet.odds,
    highest: Math.max(all.highest, bet.odds),
  }), { stake: 0, payout: 0, highest: 0 }), [bets]);
  const chosen = bets.filter((bet) => selected.has(bet.id));
  const selectedStake = chosen.reduce((sum, bet) => sum + bet.stake, 0);
  const selectedPayout = chosen.reduce((sum, bet) => sum + bet.stake * bet.odds, 0);

  function toggleBet(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleBet(id);
  }

  function beginDrag(event: DragEvent<HTMLElement>, id: string) {
    setDraggedId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }

  function markDrop(event: DragEvent<HTMLElement>, id: string) {
    if (!draggedId || draggedId === id) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({ id, edge: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
  }

  function finishDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!draggedId || !dropTarget || draggedId === dropTarget.id) return endDrag();
    setBets((current) => {
      const moved = current.find((bet) => bet.id === draggedId);
      if (!moved) return current;
      const withoutMoved = current.filter((bet) => bet.id !== draggedId);
      const targetIndex = withoutMoved.findIndex((bet) => bet.id === dropTarget.id);
      if (targetIndex < 0) return current;
      const insertAt = targetIndex + (dropTarget.edge === 'after' ? 1 : 0);
      return [...withoutMoved.slice(0, insertAt), moved, ...withoutMoved.slice(insertAt)];
    });
    setSettlingId(draggedId);
    window.setTimeout(() => setSettlingId(null), 360);
    endDrag();
  }

  function endDrag() {
    setDraggedId(null);
    setDropTarget(null);
  }

  function removeBet(id: string) {
    setBets((current) => current.filter((bet) => bet.id !== id));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function addBet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const odds = Number(String(data.get('odds')).replace(',', '.'));
    const stake = Number(data.get('stake'));
    if (!(odds > 1) || !(stake > 0)) return;
    setBets((current) => [...current, {
      id: crypto.randomUUID(),
      category: data.get('category') as Category,
      market: String(data.get('market')).trim(),
      selection: String(data.get('selection')).trim(),
      odds,
      stake,
    }]);
    setShowAdd(false);
  }

  return (
    <div className="odds-page" data-theme={theme}>
      <div className="odds-atmosphere" aria-hidden="true" />
      <main className="tracker-shell">
        <nav className="tracker-nav" aria-label="Oddsen-Tracker">
          <a className="tracker-brand" href="#top" aria-label="Oddsen-Tracker, til toppen">
            <span className="brand-orbit"><Trophy size={17} /></span>
            <span><strong>Oddsen-Tracker</strong><small>Fotball-VM 2026</small></span>
          </a>
          <div className="nav-actions">
            <button className="theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={`Bytt til ${theme === 'dark' ? 'lyst' : 'mørkt'} tema`} title={`Bytt til ${theme === 'dark' ? 'lyst' : 'mørkt'} tema`}>
              <Sun className="sun-icon" size={17} /><Moon className="moon-icon" size={17} />
            </button>
            <button className="ghost-button" type="button" onClick={() => { setBets(INITIAL_BETS); setSelected(new Set()); }}>
              <RotateCcw size={15} /><span>Tilbakestill demo</span>
            </button>
          </div>
        </nav>

        <section id="top" className="world-cup-hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="hero-kicker">Nord-Amerika 2026 · Turneringsoversikt</span>
            <h1 id="hero-title">Fotball-VM <em>2026</em></h1>
            <p>De største kampene og alle VM-spillene dine, samlet i én kompromissløs oversikt.</p>
            <div className="market-pills" aria-label="Aktuelle markeder">
              <span>Kampvinner</span><span>Målscorer</span><span>Toppscorer</span><span>Turneringsvinner</span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-ball"><i /><b>26</b><span>World Cup</span></div>
          </div>
          <dl className="hero-stats">
            <div><dt>VM-spill</dt><dd>{bets.length}</dd></div>
            <div><dt>Total innsats</dt><dd>{money.format(totals.stake)} kr</dd></div>
            <div><dt>Høyeste odds</dt><dd>{totals.highest.toFixed(2)}</dd></div>
          </dl>
        </section>

        <section className="overview-card" aria-labelledby="overview-title">
          <div className="overview-copy">
            <span className="section-kicker">Oddsenoversikt</span>
            <h2 id="overview-title">Mine <em>spill</em></h2>
            <p>En kampklar oversikt over rekkefølge, innsats og mulig premie.</p>
            <button className="primary-button" type="button" onClick={() => setShowAdd(true)}><Plus size={17} /> Legg til spill</button>
          </div>
          <dl className="overview-stats">
            <div><dt>Aktive spill</dt><dd>{bets.length}</dd></div>
            <div><dt>Total innsats</dt><dd>{money.format(totals.stake)} kr</dd></div>
            <div><dt>Mulig utbetaling</dt><dd>{money.format(totals.payout)} kr</dd></div>
            <div><dt>Snittodds</dt><dd>{bets.length ? (bets.reduce((sum, bet) => sum + bet.odds, 0) / bets.length).toFixed(2) : '—'}</dd></div>
          </dl>
        </section>

        <section className="selection-bar" aria-live="polite">
          <div className="selection-copy"><span>Kupongbygger</span><strong>{chosen.length ? `${chosen.length} markert` : 'Marker spill'}</strong><small>Klikk direkte på en rad for å velge den.</small></div>
          <div><span>Innsats</span><strong>{money.format(selectedStake)} kr</strong></div>
          <div className="positive"><span>Mulig premie</span><strong>{money.format(selectedPayout)} kr</strong></div>
          <div className="positive"><span>Mulig netto</span><strong>+{money.format(Math.max(0, selectedPayout - selectedStake))} kr</strong></div>
          <button type="button" onClick={() => setSelected(new Set())} disabled={!chosen.length}>Nullstill</button>
        </section>

        <section className="match-card" aria-labelledby="match-title">
          <header className="match-header">
            <div>
              <span className="section-kicker">VM 2026 / Gruppe E</span>
              <h2 id="match-title"><b>ESP</b><i>mot</i><b>BEL</b></h2>
              <p>Spania mot Belgia · Fredag 10. juli, 21:00</p>
            </div>
            <dl>
              <div><dt>Spill</dt><dd>{bets.length}</dd></div>
              <div><dt>Satset</dt><dd>{money.format(totals.stake)} kr</dd></div>
              <div><dt>Toppodds</dt><dd>{totals.highest.toFixed(2)}</dd></div>
            </dl>
          </header>

          <div className="filter-bar" aria-label="Filtrer spill">
            {CATEGORIES.map((category) => {
              const count = category === 'Alle' ? bets.length : bets.filter((bet) => bet.category === category).length;
              if (category !== 'Alle' && count === 0) return null;
              return <button key={category} type="button" className={filter === category ? 'active' : ''}
                aria-pressed={filter === category} onClick={() => setFilter(category)}>{category}<span>{count}</span></button>;
            })}
            <p><GripVertical size={14} /> Dra spillene for å endre rekkefølge</p>
          </div>

          <div className="bet-columns" aria-hidden="true"><span /><span>Type og spill</span><span>Odds</span><span>Innsats</span><span>Mulig premie</span><span /></div>
          <div className="bet-list" role="listbox" aria-label="Spill" aria-multiselectable="true"
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null); }}>
            {visibleBets.map((bet, index) => {
              const payout = bet.stake * bet.odds;
              const isSelected = selected.has(bet.id);
              const dropClass = dropTarget?.id === bet.id ? `drop-${dropTarget.edge}` : '';
              return (
                <article key={bet.id} className={`bet-row category-${categoryClass[bet.category]} ${isSelected ? 'selected' : ''} ${draggedId === bet.id ? 'dragging' : ''} ${settlingId === bet.id ? 'settling' : ''} ${dropClass}`}
                  draggable onDragStart={(event) => beginDrag(event, bet.id)} onDragOver={(event) => markDrop(event, bet.id)} onDrop={finishDrop} onDragEnd={endDrag}
                  onClick={() => toggleBet(bet.id)} onKeyDown={(event) => handleRowKeyDown(event, bet.id)}
                  role="option" tabIndex={0} aria-selected={isSelected} aria-label={`${bet.market}: ${bet.selection}`}>
                  <span className="drag-control" aria-hidden="true"><GripVertical size={17} /><b>{String(index + 1).padStart(2, '0')}</b></span>
                  <div className="bet-main"><span><i>{categoryCode[bet.category]}</i>{bet.market}</span><strong>{bet.selection}</strong></div>
                  <div className="bet-number odds"><span>Odds</span><strong>{bet.odds.toFixed(2)}</strong></div>
                  <div className="bet-number"><span>Innsats</span><strong>{money.format(bet.stake)} kr</strong></div>
                  <div className="bet-number payout"><span>Mulig premie</span><strong>{money.format(payout)} kr</strong><small>+{money.format(payout - bet.stake)} kr netto</small></div>
                  <button className="delete-bet" type="button" onClick={(event) => { event.stopPropagation(); removeBet(bet.id); }} aria-label={`Slett ${bet.selection}`}><Trash2 size={15} /></button>
                </article>
              );
            })}
          </div>
          <footer className="match-footer"><span>{visibleBets.length} av {bets.length} spill · dra og slipp aktivert</span><strong>Total mulig utbetaling {money.format(totals.payout)} kr</strong></footer>
        </section>
      </main>

      {showAdd && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAdd(false)}>
          <section className="add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span className="section-kicker">Nytt spill</span><h2 id="add-title">Legg til i oversikten</h2></div><button type="button" onClick={() => setShowAdd(false)} aria-label="Lukk"><X /></button></header>
            <form onSubmit={addBet}>
              <label>Kategori<select name="category" defaultValue="Kamp">{CATEGORIES.slice(1).map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Marked<input name="market" required placeholder="For eksempel totalt antall mål" /></label>
              <label className="wide">Spillvalg<input name="selection" required placeholder="For eksempel over 2,5 mål" /></label>
              <label>Odds<input name="odds" required inputMode="decimal" placeholder="2,10" /></label>
              <label>Innsats<input name="stake" required type="number" min="1" step="1" placeholder="100" /></label>
              <button className="primary-button wide" type="submit"><ArrowDownToLine size={17} /> Legg til spill</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
