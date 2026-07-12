import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCouponBoxes, detectOcrGridBoxes, draftErrors, mergePositionedWithText, parseCouponText, parsePositionedCoupon } from './OddsenTracker';

afterEach(() => vi.useRealTimers());

describe('kupongimport', () => {
  it('leser en komplett Oddsen-kvittering', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'));
    const result = parseCouponText(`Innsats: 100,00
Odds: 2.10
Mulig Premie: 210,00
1. Norge v England
Starttid: Lør. 11/7 23:00
Konkurranse: Fotball-VM
Spillobjekt: Scorer mål
Spilt utfall: Erling Haaland
Levert: 10.07.2026
Kupongnummer: 123.1`);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      match: 'Norge v England', market: 'Scorer mål', selection: 'Erling Haaland',
      kickoff: '11.07.2026 23:00', odds: '2.1', stake: '100', payout: '210', category: 'Spiller', coupon: '123.1',
    });
  });

  it.each([
    ['Fre. 10/7 21:00', '10.07.2026 21:00'],
    ['Lør. 11/7 23:00', '11.07.2026 23:00'],
    ['Søn. 19/7 02:00', '19.07.2026 02:00'],
    ['Fre. 10 / 7 21 : 00', '10.07.2026 21:00'],
  ])('bruker inneværende år for norsk starttid %s', (starttid, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'));
    const [result] = parseCouponText(`Innsats: 100,00
Odds: 2.10
Mulig Premie: 210,00
1. Spania v Belgia
Starttid: ${starttid}
Konkurranse: Internasjonal - Fotball - VM
Spillobjekt: Totalt antall mål
Spillutfall: Over 3.5
Kupongnummer: 299682724.1`);
    expect(result.kickoff).toBe(expected);
  });

  it.each([
    ['Spania og Under 2.5 mål', '4.20', '420,00', 'Singel Aktiv'],
    ['Over 3.5', '2.10', '210,00', 'System Levert'],
    ['Ja', '11.50', '1150,00', 'Singel Levert'],
  ])('henter «%s» rett under Spillutfall og ignorerer kupongstatus', (selection, odds, payout, status) => {
    const [result] = parseCouponText(`Oddsen
${status}
Innsats: 100,00
Odds: ${odds}
Mulig Premie: ${payout}
1. Spania v Belgia
Starttid: Fre. 10/7 21:00
Konkurranse: Internasjonal - Fotball - VM
Spillobjekt: HUB og antall mål
Spillutfall:
${selection}
${odds}
Levert: 10.07.2026, kl. 00:27:21
Kupongnummer: 299681641.1`);

    expect(result.selection).toBe(selection);
    expect(result.selection).not.toMatch(/Singel|System|Aktiv|Levert/i);
  });

  it('leser flere kuponger i samme tekst', () => {
    const receipt = (coupon: number) => `Innsats: 50,00\nOdds: 3.00\nMulig Premie: 150,00\n1. Spania v Belgia\nStarttid: 10/7 21:00\nKonkurranse: Fotball-VM\nSpillobjekt: Kampvinner\nSpilt utfall: Spania\nKupongnummer: ${coupon}.1`;
    expect(parseCouponText(`${receipt(1)}\n\n${receipt(2)}`)).toHaveLength(2);
  });

  it('beholder alle spillvalg i en kombinasjonskupong og grupperer dem sammen', () => {
    const results = parseCouponText(`Innsats: 100,00
Odds: 6.00
Mulig Premie: 600,00
1. Norge v England
Starttid: Lør. 11/7 23:00
Konkurranse: Fotball-VM
Spillobjekt: Kampvinner
Spilt utfall: Norge 3.00
2. Spania v Belgia
Starttid: Fre. 10/7 21:00
Konkurranse: Fotball-VM
Spillobjekt: Begge lag scorer
Spilt utfall: Ja 2.00
Kupongnummer: 29968164.1`);

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.match)).toEqual(['Norge v England', 'Spania v Belgia']);
    expect(results.map((item) => item.selection)).toEqual(['Norge · delodds 3.00', 'Ja · delodds 2.00']);
    expect(results.map((item) => item.category)).toEqual(['Resultat', 'Kamp']);
    expect(new Set(results.map((item) => item.groupId)).size).toBe(1);
    expect(results.every((item) => draftErrors(item).length === 0)).toBe(true);
  });

  it('leser flere spillvalg selv når OCR har flatet ut linjeskiftene', () => {
    const results = parseCouponText('Innsats: 100,00 Odds: 6.00 Mulig Premie: 600,00 1) Norge v England Starttid: 11/7 23:00 Konkurranse: Fotball-VM Spillobjekt: Kampvinner Spilt utfall: Norge 3.00 2) Spania v Belgia Starttid: 10/7 21:00 Konkurranse: Fotball-VM Spillobjekt: Begge lag scorer Spilt utfall: Ja 2.00 Kupongnummer: 99.1');
    expect(results).toHaveLength(2);
    expect(results.map((item) => item.selection)).toEqual(['Norge · delodds 3.00', 'Ja · delodds 2.00']);
  });

  it('gir spillvalg uten lest kupongnummer samme interne kuponggruppe', () => {
    const results = parseCouponText('Innsats: 100,00 Odds: 6.00 Mulig Premie: 600,00 1. Norge v England Starttid: 11/7 23:00 Konkurranse: Fotball-VM Spillobjekt: Kampvinner Spilt utfall: Norge 3.00 2. Spania v Belgia Starttid: 10/7 21:00 Konkurranse: Fotball-VM Spillobjekt: Kampvinner Spilt utfall: Spania 2.00');
    expect(results).toHaveLength(2);
    expect(results[0].coupon).toBe('');
    expect(results[0].groupId).toBe(results[1].groupId);
  });

  it('støtter enkel etikettbasert tekst', () => {
    const [result] = parseCouponText('Kamp: Norge mot England\nMarked: Totalt antall mål\nUtfall: Over 2,5\nOdds: 1,90\nInnsats: 100\nMulig premie: 190');
    expect(result).toMatchObject({ match: 'Norge mot England', market: 'Totalt antall mål', selection: 'Over 2,5', odds: '1.9', stake: '100', payout: '190' });
  });

  it('deler et testark med ti kuponger og svært smale kolonneskiller', () => {
    const width = 500; const height = 800; const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) data[index + 3] = 255;
    const paint = (x: number, y: number, w: number, h: number) => {
      for (let row = y; row < y + h; row += 1) for (let column = x; column < x + w; column += 1) {
        const offset = ((row * width) + column) * 4; data[offset] = 255; data[offset + 1] = 255; data[offset + 2] = 255;
      }
    };
    for (const [column, x] of [0, 167, 334].entries()) for (let row = 0; row < (column === 0 ? 4 : 3); row += 1) paint(x, 20 + row * 185, 166, 160);
    expect(detectCouponBoxes({ width, height, data })).toHaveLength(10);
  });

  it('retter OCR-odds der desimalpunktet blir lest som mellomrom', () => {
    const [item] = parseCouponText('Innsats: 50,00\nOdds: 2 10\nMulig Premie: 105,00\n1. Spania v Belgia\nStarttid: 10/7 21:00\nKonkurranse: Fotball-VM\nSpillobjekt: Totalt antall mål\nSpilt utfall: Over 3,5\nKupongnummer: 29968164.1');
    expect(item.odds).toBe('2.1');
    expect(draftErrors(item)).toEqual([]);
  });

  it('bygger ti separate kupongceller fra OCR-ankere i et 2 × 5-rutenett', () => {
    const lines = Array.from({ length: 5 }, (_, row) => [100, 300].map((x) => ({
      text: 'Kupongnummer', bbox: { x0: x - 25, y0: 80 + row * 150, x1: x + 25, y1: 95 + row * 150 },
      words: [{ text: 'Kupongnummer', bbox: { x0: x - 25, y0: 80 + row * 150, x1: x + 25, y1: 95 + row * 150 } }],
    }))).flat();
    const boxes = detectOcrGridBoxes(400, 800, [{ paragraphs: [{ lines }] }]);
    expect(boxes).toHaveLength(10);
    expect(new Set(boxes.map((box) => box.x)).size).toBe(2);
    expect(new Set(boxes.map((box) => box.y)).size).toBe(5);
    expect(boxes[0].height).toBeLessThan(120);
    expect(boxes[2].y).toBe(boxes[0].height);
  });

  it('lager ingen fantomkort i et ragget OCR-rutenett med 4 + 3 + 3 kuponger', () => {
    const columnRows = [[85, 265, 445, 625], [85, 265, 445], [85, 265, 445]];
    const lines = columnRows.flatMap((rows, column) => rows.map((y) => ({
      text: 'Kupongnummer', bbox: { x0: 45 + column * 160, y0: y, x1: 110 + column * 160, y1: y + 14 },
      words: [{ text: 'Kupongnummer', bbox: { x0: 45 + column * 160, y0: y, x1: 110 + column * 160, y1: y + 14 } }],
    })));
    const boxes = detectOcrGridBoxes(480, 760, [{ paragraphs: [{ lines }] }]);
    expect(boxes).toHaveLength(10);
  });

  it('bruker de posisjonerte Spillutfall-radene under sammendraget, ikke kuponghodet', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'));
    const line = (text: string, y: number, x0 = 20, x1 = 220) => ({ text, bbox: { x0, y0: y, x1, y1: y + 10 } });
    const blocks = [{ paragraphs: [{ lines: [
      line('Oddsen Singel Aktiv', 0, 10, 300),
      line('Innsats: 300,00', 20),
      line('Odds: 4.20', 40, 20, 100),
      line('Mulig Premie: 1260,00', 40, 120, 300),
      line('1. Spania v Belgia', 90),
      line('Starttid:', 110),
      line('Fre. 10/7 21:00', 130),
      line('Konkurranse:', 150),
      line('Internasjonal - Fotball - VM', 170),
      line('Spillobjekt:', 190),
      line('HUB og antall mål', 210),
      line('Spillutfall:', 230),
      line('Spania og Under 2.5 mål', 250, 20, 190),
      line('4.20', 250, 240, 280),
      line('Levert: 10.07.2026, kl. 00:27:21', 280),
      line('Kupongnummer: 299681641.1', 300),
    ] }] }];

    const result = parsePositionedCoupon(blocks);
    expect(result).toMatchObject({
      match: 'Spania v Belgia',
      kickoff: '10.07.2026 21:00',
      market: 'HUB og antall mål',
      selection: 'Spania og Under 2.5 mål',
      odds: '4.2',
      stake: '300',
      payout: '1260',
    });
    expect(result?.selection).not.toMatch(/Oddsen|Singel|System|Aktiv|Levert/i);

    const textResult = parseCouponText(`Innsats: 300,00
Odds: 4.20
Mulig Premie: 1260,00
1. Spania v Belgia
Starttid: Fre. 10/7 21:00
Konkurranse: Internasjonal - Fotball - VM
Spillobjekt: HUB og antall mål
Spillutfall: Spania og Under 2.5 mål
Kupongnummer: 299681641.1`);
    const positionedWithHeaderSelection = result ? { ...result, selection: '> Oddsen sige Aktiv' } : null;
    const [merged] = mergePositionedWithText(positionedWithHeaderSelection, textResult);
    expect(merged).toMatchObject({ kickoff: '10.07.2026 21:00', selection: 'Spania og Under 2.5 mål' });
  });

  it('stopper sammenslått OCR-tekst og økonomiavvik', () => {
    const [item] = parseCouponText('Kamp: Spania v Belgia Spillobjekt: Tidspunkt for mål\nMarked: Kampvinner\nUtfall: Spilt utfall Odds: 11.50 Kupongnummer: 1\nOdds: 11.50\nInnsats: 300\nMulig premie: 1150');
    expect(draftErrors(item).length).toBeGreaterThan(0);
  });
});
