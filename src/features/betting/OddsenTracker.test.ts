import { describe, expect, it } from 'vitest';
import { detectCouponBoxes, detectOcrGridBoxes, draftErrors, parseCouponText } from './OddsenTracker';

describe('kupongimport', () => {
  it('leser en komplett Oddsen-kvittering', () => {
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
      odds: '2.1', stake: '100', payout: '210', category: 'Spiller', coupon: '123.1',
    });
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
Kupongnummer: 99.1`);

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
    const [item] = parseCouponText('Innsats: 50,00\nOdds: 2 10\nMulig Premie: 105,00\n1. Spania v Belgia\nStarttid: 10/7 21:00\nKonkurranse: Fotball-VM\nSpillobjekt: Totalt antall mål\nSpilt utfall: Over 3,5\nKupongnummer: 1.1');
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

  it('stopper sammenslått OCR-tekst og økonomiavvik', () => {
    const [item] = parseCouponText('Kamp: Spania v Belgia Spillobjekt: Tidspunkt for mål\nMarked: Kampvinner\nUtfall: Spilt utfall Odds: 11.50 Kupongnummer: 1\nOdds: 11.50\nInnsats: 300\nMulig premie: 1150');
    expect(draftErrors(item).length).toBeGreaterThan(0);
  });
});
