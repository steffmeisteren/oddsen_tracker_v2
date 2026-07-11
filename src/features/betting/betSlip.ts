import type { BetSlip, BettingMarket, BettingSelection, UserBet } from '../../types/domain';

const correlationGroups: Record<string, string[]> = {
  goals: ['begge lag scorer', 'over', 'mål', 'scorer'],
  result: ['seier', 'dobbelsjanse', 'draw no bet', 'handicap'],
  discipline: ['kort', 'rødt'],
  corners: ['corner'],
};

export function selectionToUserBet(market: BettingMarket, selection: BettingSelection, odds: number): UserBet {
  return {
    id: crypto.randomUUID(),
    marketId: market.id,
    selectionId: selection.id,
    label: `${market.name}: ${selection.label}`,
    odds,
    correlatedWith: [],
  };
}

export function findCorrelations(bets: UserBet[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const bet of bets) {
    const text = bet.label.toLocaleLowerCase('nb-NO');
    const groups = Object.entries(correlationGroups)
      .filter(([, terms]) => terms.some((term) => text.includes(term)))
      .map(([group]) => group);
    const related = bets
      .filter((candidate) => candidate.id !== bet.id)
      .filter((candidate) => {
        const candidateText = candidate.label.toLocaleLowerCase('nb-NO');
        return groups.some((group) => correlationGroups[group].some((term) => candidateText.includes(term)));
      })
      .map((candidate) => candidate.id);
    if (related.length) result.set(bet.id, related);
  }
  return result;
}

export function exportBetSlipsJson(slips: BetSlip[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), slips }, null, 2);
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function exportBetSlipsCsv(slips: BetSlip[]): string {
  const header = ['kupong', 'opprettet', 'kamp', 'innsats', 'valg', 'odds', 'notat'];
  const rows = slips.flatMap((slip) => slip.bets.map((bet) => [
    slip.name, slip.createdAt, slip.fixtureId, slip.stake, bet.label, bet.odds, bet.note ?? slip.note ?? '',
  ]));
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
