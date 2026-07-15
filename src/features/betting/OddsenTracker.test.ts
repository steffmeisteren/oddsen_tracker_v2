import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCanonicalImportSources,
  decodeCanonicalCouponImage,
  detectCouponBoxes,
  detectOcrGridBoxes,
  draftErrors,
  draftWarnings,
  evaluateImportFileSelection,
  getImportFailureMessage,
  getImageSelectionLabel,
  getSegmentationDimensions,
  getImportOcrConcurrency,
  getImportReviewStatus,
  getTesseractAssetPaths,
  ImportAbortError,
  materializeMatchSort,
  mergePositionedWithText,
  nextBetSort,
  normalizeNorwegianBetText,
  openImportFilePicker,
  parseCouponText,
  parsePositionedCoupon,
  processImportSourcesInOrder,
  readImportFileSelection,
  recoverImportSourcePreview,
  releaseImportSourcePreview,
  runTwoPhaseImportQueue,
  sortBetsForDisplay,
  validateImportForPersistence,
  type TrackedBet,
} from './OddsenTracker';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('kupongimport', () => {
  it.each([
    ['Scorer begge lagi 1 omgang?', 'market', 'Scorer begge lag i 1. omgang?'],
    ['Scorer begge lag i 2 omgang?', 'market', 'Scorer begge lag i 2. omgang?'],
    ['Mal scoret på direkte frispark', 'market', 'Mål scoret på direkte frispark'],
    ['scorer mal i 1 omgang', 'selection', 'scorer mål i 1. omgang'],
    ['Antall mal over 2.5', 'market', 'Antall mål over 2.5'],
    ['MAL?', 'market', 'MÅL?'],
    ['Scorer begge lag i 1. omgang?', 'market', 'Scorer begge lag i 1. omgang?'],
    ['Scorer begge lag i 2. omgang?', 'market', 'Scorer begge lag i 2. omgang?'],
    ['Mal Donaghy', 'selection', 'Mal Donaghy'],
  ] as const)('normaliserer norsk fotballtekst «%s» uten å endre fritekst', (input, context, expected) => {
    expect(normalizeNorwegianBetText(input, context)).toBe(expected);
  });

  it('bruker norsk marked-normalisering både ved parsing og ny validering', () => {
    const [parsed] = parseCouponText(`Innsats: 100,00
Odds: 3.65
Mulig Premie: 365,00
1. England v Argentina
Starttid: Ons. 15/7 21:00
Konkurranse: Internasjonal - Fotball-VM
Spillobjekt: Scorer begge lagi 1 omgang?
Spilt utfall: Ja
Levert: 14.07.2026`);
    const revalidated = validateImportForPersistence([{ ...parsed, market: 'Mal scoret i 2 omgang' }]);

    expect(parsed.market).toBe('Scorer begge lag i 1. omgang?');
    expect(revalidated.normalized[0].market).toBe('Mål scoret i 2. omgang');
  });

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
      match: 'Norge vs England', market: 'Scorer mål', selection: 'Erling Haaland',
      kickoff: '11.07.2026 23:00', odds: '2.1', stake: '100', payout: '210', category: 'Spiller', coupon: '123.1',
    });
  });

  it.each([
    ['Fre. 10/7 21:00', '10.07.2026 21:00'],
    ['Lør. 11/7 23:00', '11.07.2026 23:00'],
    ['Søn. 19/7 02:00', '19.07.2026 02:00'],
    ['Fre. 10 / 7 21 : 00', '10.07.2026 21:00'],
  ])('bruker kupongens referanseår for norsk starttid %s', (starttid, expected) => {
    const [result] = parseCouponText(`Innsats: 100,00
Odds: 2.10
Mulig Premie: 210,00
1. Spania v Belgia
Starttid: ${starttid}
Konkurranse: Internasjonal - Fotball - VM
Spillobjekt: Totalt antall mål
Spillutfall: Over 3.5
Levert: 09.07.2026
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
Levert: 09.07.2026
Kupongnummer: 29968164.1`);

    expect(results).toHaveLength(2);
    expect(results.map((item) => item.match)).toEqual(['Norge vs England', 'Spania vs Belgia']);
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
    expect(result).toMatchObject({ match: 'Norge vs England', market: 'Totalt antall mål', selection: 'Over 2,5', odds: '1.9', stake: '100', payout: '190' });
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
    const [item] = parseCouponText('Innsats: 50,00\nOdds: 2 10\nMulig Premie: 105,00\n1. Spania v Belgia\nStarttid: 10/7 21:00\nKonkurranse: Fotball-VM\nSpillobjekt: Totalt antall mål\nSpilt utfall: Over 3,5\nLevert: 09.07.2026\nKupongnummer: 29968164.1');
    expect(item.odds).toBe('2.1');
    expect(draftErrors(item)).toEqual([]);
  });

  it('retter OCR-kupongnummer når etiketten og desimalpunktet feilleses', () => {
    const rawText = `Innsats: 300,00
Odds: 4.20
Mulig Premie: 1260,00
1. Spania v Belgia
Starttid: Fre. 10/7 21:00
Konkurranse: Internasjonal - Fotball-VM
Spillobjekt: HUB og antall mål
Spilt utfall: Spania og Under 2.5 mål
Levert: 10.07.2026, kl. 00:27:21
Kupongnuminer: 299681614.1`;
    const line = (text: string, y: number) => ({ text, bbox: { x0: 20, y0: y, x1: 280, y1: y + 10 } });
    const positioned = parsePositionedCoupon([{ paragraphs: [{ lines: rawText.split('\n').map((text, index) => line(text, index * 20)) }] }]);
    const textCandidates = parseCouponText(rawText);
    const [merged] = mergePositionedWithText(positioned, textCandidates);
    const [binary] = parseCouponText(rawText.replace('Kupongnuminer: 299681614.1', 'Kupongnuminer. 299681614 1'));

    expect(positioned?.coupon).toBe('299681614.1');
    expect(textCandidates[0].coupon).toBe('299681614.1');
    expect(binary.coupon).toBe('299681614.1');
    expect(merged.coupon).toBe('299681614.1');
    expect(draftErrors(merged)).toEqual([]);
  });

  it('godkjenner manglende kupongnummer med stabil intern ID og feltbasert deduplisering', () => {
    const raw = `Innsats: 100,00
Odds: 3.65
Mulig Premie: 365,00
1. England v Argentina
Starttid: Ons. 15/7 21:00
Konkurranse: Internasjonal - Fotball-VM
Spillobjekt: Scorer begge lag i 2. omgang?
Spilt utfall: Ja
Levert: 14.07.2026`;
    const first = parseCouponText(raw, '3158.jpg')[0];
    const second = parseCouponText(raw, '3158.jpg')[0];

    const firstBatch = validateImportForPersistence([first]);
    const duplicateBatch = validateImportForPersistence([first, second]);

    expect(firstBatch.invalid).toEqual([]);
    expect(firstBatch.ready).toHaveLength(1);
    expect(firstBatch.normalized[0].coupon).toBe('');
    expect(firstBatch.normalized[0].groupId).toMatch(/^intern:/);
    expect(validateImportForPersistence([second]).normalized[0].groupId).toBe(firstBatch.normalized[0].groupId);
    expect(duplicateBatch.ready).toHaveLength(1);
    expect(draftWarnings(firstBatch.normalized[0])).toContain('Kupongnummer mangler. Duplikatkontroll bruker kamp, tidspunkt, marked, spillvalg og beløp.');
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
      line('Kupongnummer: 299681614.1', 300),
    ] }] }];

    const result = parsePositionedCoupon(blocks);
    expect(result).toMatchObject({
      match: 'Spania vs Belgia',
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
Kupongnummer: 299681614.1`);
    const positionedWithHeaderSelection = result ? { ...result, selection: '> Oddsen sige Aktiv' } : null;
    const [merged] = mergePositionedWithText(positionedWithHeaderSelection, textResult);
    expect(merged).toMatchObject({ kickoff: '10.07.2026 21:00', selection: 'Spania og Under 2.5 mål' });
  });

  it('skiller Spillobjekt fra turnering når PC-OCR slår feltene sammen', () => {
    const line = (text: string, y: number, x0 = 20, x1 = 280) => ({ text, bbox: { x0, y0: y, x1, y1: y + 10 } });
    const blocks = [{ paragraphs: [{ lines: [
      line('Innsats: 100,00', 0),
      line('Odds: 2.85', 20, 20, 100),
      line('Mulig Premie: 285,00', 20, 120, 300),
      line('1. Spania v Belgia', 60),
      line('Starttid:', 80),
      line('Fre. 10/7 21:00', 100),
      line('Konkurranse:', 120),
      line('Internasjonal - Fotball VM Spillobjekt', 140),
      line('Belgia vinner minst en omgang', 160),
      line('Spillutfall:', 180),
      line('Ja', 200),
      line('Levert: 10.07.2026, kl. 00:30:25', 220),
      line('Kupongnummer: 299682488.1', 240),
    ] }] }];

    const positioned = parsePositionedCoupon(blocks);
    const textCandidates = parseCouponText(`Innsats: 100,00
Odds: 2.85
Mulig Premie: 285,00
1. Spania v Belgia
Starttid: Fre. 10/7 21:00
Konkurranse: Internasjonal - Fotball-VM
Spillobjekt: Belgia vinner minst en omgang
Spillutfall: Ja
Levert: 10.07.2026, kl. 00:30:25
Kupongnummer: 299682488.1`);
    const [merged] = mergePositionedWithText(positioned, textCandidates);

    expect(draftErrors(merged)).not.toContain('Kamp/event må kontrolleres. Bruk lagene (for eksempel Frankrike vs Spania), ikke turneringsnavn, marked eller tidspunkt.');
    expect(merged).toMatchObject({
      match: 'Spania vs Belgia',
      competition: 'Internasjonal - Fotball-VM',
      market: 'Belgia vinner minst en omgang',
      selection: 'Ja',
      kickoff: '10.07.2026 21:00',
      odds: '2.85',
      stake: '100',
      payout: '285',
      coupon: '299682488.1',
    });
    expect(draftErrors(merged)).toEqual([]);

    const persistence = validateImportForPersistence([{
      ...merged,
      competition: `${merged.competition} Spillobjekt ${merged.market}`,
    }]);
    expect(persistence.normalized[0].competition).toBe('Internasjonal - Fotball-VM');
    expect(persistence.invalid).toEqual([]);
    expect(persistence.ready).toHaveLength(1);
  });

  it('beholder feltord som er en legitim del av markedsteksten', () => {
    const line = (text: string, y: number) => ({ text, bbox: { x0: 20, y0: y, x1: 280, y1: y + 10 } });
    const result = parsePositionedCoupon([{ paragraphs: [{ lines: [
      line('Innsats: 100,00', 0),
      line('Odds: 2.00', 20),
      line('Mulig Premie: 200,00', 40),
      line('1. Spania v Belgia', 60),
      line('Starttid: Fre. 10/7 21:00', 80),
      line('Konkurranse: Internasjonal - Fotball-VM', 100),
      line('Spillobjekt: Korrekt utfall', 120),
      line('Spillutfall: Ja', 140),
      line('Levert: 10.07.2026, kl. 00:30:25', 160),
      line('Kupongnummer: 299682488.1', 180),
    ] }] }]);

    expect(result?.market).toBe('Korrekt utfall');
  });

  it('stopper sammenslått OCR-tekst og økonomiavvik', () => {
    const [item] = parseCouponText('Kamp: Spania v Belgia Spillobjekt: Tidspunkt for mål\nMarked: Kampvinner\nUtfall: Spilt utfall Odds: 11.50 Kupongnummer: 1\nOdds: 11.50\nInnsats: 300\nMulig premie: 1150');
    expect(draftErrors(item).length).toBeGreaterThan(0);
  });

  it('rekonstruerer mobil-OCR med turneringslinje og separate lagnavn', () => {
    const [item] = parseCouponText(`Singel
Internasjonal - Fotball-VM
Frankrike
Spania
I dag 21:00
Scorer mål
Kylian Mbappe 2.10
Odds 2.10
Innsats 500 kr
Mulig premie 1 050 kr
Dato 14. juli 2026, 15:34
ID 301648248.1`);

    expect(item).toMatchObject({
      match: 'Frankrike vs Spania',
      kickoff: '14.07.2026 21:00',
      market: 'Scorer mål',
      selection: 'Kylian Mbappe',
      odds: '2.1',
      stake: '500',
      payout: '1050',
      coupon: '301648248.1',
    });
    expect(draftErrors(item)).toEqual([]);
  });

  it('normaliserer «I morgen» fra kjøpsdatoen, også over et årsskifte', () => {
    const [item] = parseCouponText(`Oddsen
Singel
Internasjonal - Fotball-VM
Frankrike
Spania
I morgen 00:15
Scorer mål
Kylian Mbappe 2.10
Odds 2.10
Innsats 500 kr
Mulig premie 1 050 kr
Dato 31. desember 2026, 23:59
ID 301648248.1`);

    expect(item.kickoff).toBe('01.01.2027 00:15');
    expect(draftErrors(item)).toEqual([]);
  });

  it('beholder et spesialevent uten å konstruere et kunstig «vs»-kampnavn', () => {
    const [item] = parseCouponText(`Oddsen
Singel
VM 2026 - Spesialer
Norges Fotball-VM 2026
I dag 22:59
Vinner Norge VM? (kun singelspill)
Ja 17.00
Odds 17.00
Innsats 300 kr
Mulig premie 5 100 kr
Dato 8. juli 2026, 18:57
ID 299102132.1`);

    expect(item).toMatchObject({
      match: 'Norges Fotball-VM 2026',
      kickoff: '08.07.2026 22:59',
      competition: 'VM 2026 - Spesialer',
      market: 'Vinner Norge VM? (kun singelspill)',
      selection: 'Ja',
      odds: '17',
      stake: '300',
      payout: '5100',
      coupon: '299102132.1',
      category: 'Spesial',
    });
    expect(item.match).not.toMatch(/\s(?:v|vs|mot)\s/i);
    expect(draftErrors(item)).toEqual([]);
  });

  it('ignorerer mobil-header og symbolstøy når lagene står på egne linjer', () => {
    const [item] = parseCouponText(`15:36
ya > Oddsen
Singel
& Internasjonal - Fotball-VM
Frankrike
Spania
I dag 21:00
Scorer 2 eller flere mål
Kylian Mbappe 7.50
Odds 7.50
Innsats 100 kr
Mulig premie 750 kr
Dato 14. juli 2026, 15:34
ID 301648357.1`);

    expect(item).toMatchObject({
      match: 'Frankrike vs Spania',
      kickoff: '14.07.2026 21:00',
      competition: 'Internasjonal - Fotball-VM',
      market: 'Scorer 2 eller flere mål',
      selection: 'Kylian Mbappe',
    });
    expect(`${item.match} ${item.competition}`).not.toMatch(/Oddsen|ya\s*>|\+\+/i);
    expect(draftErrors(item)).toEqual([]);
  });

  it('stopper en ellers komplett kupong når økonomien er inkonsistent', () => {
    const [item] = parseCouponText(`Kamp: Frankrike vs Spania
Starttid: 14.07.2026 21:00
Konkurranse: Internasjonal - Fotball-VM
Marked: Scorer mål
Utfall: Kylian Mbappe
Odds: 2.10
Innsats: 500
Mulig premie: 750
Kupongnummer: 301648248.1`);

    expect(draftErrors(item)).toContain('Innsats × odds stemmer ikke med mulig premie.');
    expect(validateImportForPersistence([item])).toMatchObject({
      invalid: [item],
      ready: [],
    });
  });

  it('endrer ikke økonomiske verdier for å få en inkonsistent kupong til å stemme', () => {
    const [item] = parseCouponText(`Kamp: Frankrike vs Spania
Starttid: 14.07.2026 21:00
Konkurranse: Internasjonal - Fotball-VM
Marked: Halvtid/Fulltid
Utfall: Spain - France
Odds: 25
Innsats: 200
Mulig premie: 500
Kupongnummer: 301646585.1`);

    expect(item).toMatchObject({ odds: '25', stake: '200', payout: '500' });
    expect(draftErrors(item)).toContain('Innsats × odds stemmer ikke med mulig premie.');
    expect(validateImportForPersistence([item]).ready).toEqual([]);
  });

  it('tolker ikke om manuelt korrigerte økonomifelt ved lagringsgrensen', () => {
    const [valid] = parseCouponText(`Kamp: Frankrike vs Spania
Starttid: 14.07.2026 21:00
Konkurranse: Internasjonal - Fotball-VM
Marked: Halvtid/Fulltid
Utfall: Spain - France
Odds: 25
Innsats: 200
Mulig premie: 5000
Kupongnummer: 301646585.1`);
    const edited = { ...valid, odds: '2500' };

    const result = validateImportForPersistence([edited]);

    expect(result.normalized[0].odds).toBe('2500');
    expect(result.invalid).toHaveLength(1);
    expect(result.ready).toEqual([]);
  });

  it('arver aldri kampnavn fra en annen kupong med samme tid og turnering', () => {
    const [known] = parseCouponText(`Kamp: Frankrike vs Spania
Starttid: 14.07.2026 21:00
Konkurranse: Internasjonal - Fotball-VM
Marked: Halvtid/Fulltid
Utfall: Spain - France
Odds: 25
Innsats: 200
Mulig premie: 5000
Kupongnummer: 301646585.1`);
    const unreadable = { ...known, id: crypto.randomUUID(), groupId: '301646586.1', coupon: '301646586.1', match: '' };

    const result = validateImportForPersistence([known, unreadable]);

    expect(result.normalized[1].match).toBe('');
    expect(result.invalid).toEqual([expect.objectContaining({ coupon: '301646586.1', match: '' })]);
    expect(result.ready).toEqual([]);
  });

  it('gir filvelger og drag-and-drop samme deterministiske kildeidentitet', () => {
    const files = [
      new File([new Uint8Array([1])], '3135.jpg', { type: 'image/jpeg', lastModified: 1_720_950_000_000 }),
      new File([new Uint8Array([2, 3])], '3132.jpg', { type: 'image/jpeg', lastModified: 1_720_950_001_000 }),
    ];
    const preview = (file: File) => `fixture://${file.name}`;

    const fromFilePicker = createCanonicalImportSources(files, 4, preview);
    const fromDrop = createCanonicalImportSources(Array.from(files), 4, preview);

    expect(fromFilePicker.map(({ sourceId, sourceOrder, url }) => ({ sourceId, sourceOrder, url }))).toEqual([
      { sourceId: '4:3135.jpg:1:1720950000000', sourceOrder: 4, url: 'fixture://3135.jpg' },
      { sourceId: '5:3132.jpg:2:1720950001000', sourceOrder: 5, url: 'fixture://3132.jpg' },
    ]);
    expect(fromDrop.map(({ sourceId, sourceOrder, url }) => ({ sourceId, sourceOrder, url })))
      .toEqual(fromFilePicker.map(({ sourceId, sourceOrder, url }) => ({ sourceId, sourceOrder, url })));
  });

  it('dekoder originalfilen med EXIF-orientering og bruker intrinsiske pikselmål', async () => {
    const close = vi.fn();
    const bitmap = { width: 945, height: 2048, close } as unknown as ImageBitmap;
    const createBitmap = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createBitmap);
    const original = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'mobil.jpg', { type: 'image/jpeg' });

    const decoded = await decodeCanonicalCouponImage(original);

    expect(createBitmap).toHaveBeenCalledWith(original, { imageOrientation: 'from-image' });
    expect(decoded).toMatchObject({ width: 945, height: 2048, source: bitmap });
    decoded.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('nedskalerer bare analyseflaten for svært lange bilder', () => {
    expect(getSegmentationDimensions(945, 2048)).toEqual({ width: 945, height: 2048, scaleX: 1, scaleY: 1 });
    const long = getSegmentationDimensions(1080, 12000);
    expect(long.height).toBe(4096);
    expect(long.width).toBeLessThan(1080);
    expect(long.width * long.height).toBeLessThanOrEqual(4_000_000);
    expect(long.scaleX).toBeCloseTo(long.width / 1080);
    expect(long.scaleY).toBeCloseTo(long.height / 12000);
  });

  it('bruker samme dekoder når en mobil-WebView avviser orienteringsvalget', async () => {
    const fallbackBitmap = { width: 2048, height: 945, close: vi.fn() } as unknown as ImageBitmap;
    const createBitmap = vi.fn()
      .mockRejectedValueOnce(new TypeError('imageOrientation støttes ikke'))
      .mockResolvedValueOnce(fallbackBitmap);
    vi.stubGlobal('createImageBitmap', createBitmap);
    const original = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'kamera.jpg', { type: 'image/jpeg' });

    const decoded = await decodeCanonicalCouponImage(original);

    expect(createBitmap).toHaveBeenNthCalledWith(1, original, { imageOrientation: 'from-image' });
    expect(createBitmap).toHaveBeenNthCalledWith(2, original);
    expect(decoded).toMatchObject({ width: 2048, height: 945, source: fallbackBitmap });
  });

  it('faller tilbake til bildeelement når Samsung avviser begge createImageBitmap-kall og Image.decode', async () => {
    const createBitmap = vi.fn().mockRejectedValue(new Error('The source image could not be decoded'));
    const revokeObjectURL = vi.fn();
    let imageSource = '';
    let imageComplete = false;
    let onload: (() => void) | null = null;
    const image = {
      decoding: '',
      naturalWidth: 945,
      naturalHeight: 2048,
      get complete() { return imageComplete; },
      decode: vi.fn().mockRejectedValue(new Error('EncodingError')),
      get src() { return imageSource; },
      set src(value: string) {
        imageSource = value;
        queueMicrotask(() => {
          imageComplete = true;
          onload?.();
        });
      },
      get onload() { return onload; },
      set onload(value: (() => void) | null) { onload = value; },
      onerror: null,
    } as unknown as HTMLImageElement;
    vi.stubGlobal('createImageBitmap', createBitmap);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:samsung-fallback'), revokeObjectURL });
    vi.stubGlobal('document', { createElement: vi.fn(() => image) });
    const original = new File([new Uint8Array([0xff, 0xd8, 0xff])], '3158.jpg', { type: 'image/jpeg' });

    const decoded = await decodeCanonicalCouponImage(original);

    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(image.decode).toHaveBeenCalledOnce();
    expect(decoded).toMatchObject({ width: 945, height: 2048, source: image });
    decoded.close();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:samsung-fallback');
  });

  it('beholder originalfilen OCR-lesbar når både vanlig preview og thumbnail-fallback feiler', async () => {
    const file = new File(['lesbar original'], '3158.jpg', { type: 'image/jpeg', lastModified: 123 });
    const [source] = createCanonicalImportSources([file], 0, () => 'blob:broken-preview');
    const revoke = vi.fn();

    const recovered = await recoverImportSourcePreview(
      source,
      vi.fn().mockRejectedValue(new Error('Samsung thumbnail decode failed')),
      revoke,
    );
    const [processed] = await processImportSourcesInOrder([recovered], async (item) => item.file.text());

    expect(recovered).toMatchObject({ file, url: '', previewStatus: 'error' });
    expect(revoke).toHaveBeenCalledWith('blob:broken-preview');
    expect(processed.result).toBe('lesbar original');
  });

  it('behandler filer med avgrenset samtidighet, stabil rekkefølge og isolerte feil', async () => {
    const files = [0, 1, 2, 3, 4].map((index) => new File([String(index)], `313${index + 2}.jpg`, {
      type: 'image/jpeg', lastModified: index,
    }));
    const sources = createCanonicalImportSources(files, 0, (file) => `fixture://${file.name}`);
    let active = 0;
    let maximumActive = 0;
    const settled: number[] = [];
    const completed = await processImportSourcesInOrder(sources, async (source) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, (5 - source.sourceOrder) * 2));
        if (source.sourceOrder === 2) throw new Error('Uleselig bilde');
        return source.file.name;
      } finally {
        active -= 1;
      }
    }, {
      concurrency: 2,
      onSourceSettled: (source) => settled.push(source.sourceOrder),
    });

    expect(maximumActive).toBe(2);
    expect(completed.map(({ source }) => source.sourceOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(completed[2].error).toEqual(expect.any(Error));
    expect(completed.filter(({ error }) => !error).map(({ source, result }) => [source.sourceId, result]))
      .toEqual(sources.filter((source) => source.sourceOrder !== 2).map((source) => [source.sourceId, source.file.name]));
    expect(settled.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('analyserer tre bilder før den behandler samlet 10 + 1 + 1 kuponger', async () => {
    const files = ['bulk.jpg', 'enkelt-1.jpg', 'enkelt-2.jpg'].map((name, index) => new File([name], name, {
      type: 'image/jpeg', lastModified: index,
    }));
    const sources = createCanonicalImportSources(files, 0, (file) => `fixture://${file.name}`);
    const analysisProgress: Array<[number, number]> = [];
    const couponProgress: Array<[number, number]> = [];

    const result = await runTwoPhaseImportQueue(
      sources,
      async (source) => {
        await new Promise((resolve) => setTimeout(resolve, (3 - source.sourceOrder) * 2));
        const count = source.sourceOrder === 0 ? 10 : 1;
        return Array.from({ length: count }, (_, regionOrder) => `${source.sourceOrder}:${regionOrder}`);
      },
      async (_source, regions, reportCoupon) => regions.map((region) => {
        reportCoupon();
        return `kupong-${region}`;
      }),
      {
        concurrency: 2,
        onAnalysisProgress: (current, total) => analysisProgress.push([current, total]),
        onCouponProgress: (current, total) => couponProgress.push([current, total]),
      },
    );

    expect(result.totalItems).toBe(12);
    expect(result.results).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `kupong-0:${index}`),
      'kupong-1:0',
      'kupong-2:0',
    ]);
    expect(analysisProgress.at(-1)).toEqual([3, 3]);
    expect(couponProgress[0]).toEqual([1, 12]);
    expect(couponProgress.at(-1)).toEqual([12, 12]);
  });

  it('avbryter aktiv fase og starter ikke flere kuponger', async () => {
    const [source] = createCanonicalImportSources([new File(['x'], 'bulk.jpg', { type: 'image/jpeg' })], 0, () => 'fixture://bulk.jpg');
    const controller = new AbortController();
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    const processed: string[] = [];
    const running = runTwoPhaseImportQueue(
      [source],
      async () => ['første', 'andre'],
      async (_item, regions, reportCoupon, signal) => {
        for (const region of regions) {
          processed.push(region);
          startedResolve();
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 100);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new ImportAbortError());
            }, { once: true });
          });
          reportCoupon();
        }
        return regions;
      },
      { signal: controller.signal },
    );

    await started;
    controller.abort();

    await expect(running).rejects.toBeInstanceOf(ImportAbortError);
    expect(processed).toEqual(['første']);
  });

  it('tillater 50 bildefiler, advarer over 20 og blokkerer hele tillegget over 50', () => {
    const images = Array.from({ length: 51 }, (_, index) => new File([String(index)], `bilde-${index + 1}.jpg`, { type: 'image/jpeg' }));

    expect(evaluateImportFileSelection(images.slice(0, 20))).toMatchObject({ accepted: images.slice(0, 20), total: 20, warning: '', error: '' });
    expect(evaluateImportFileSelection(images.slice(0, 21))).toMatchObject({ accepted: images.slice(0, 21), total: 21, warning: 'Mange bilder kan føre til lengre behandlingstid.', error: '' });
    expect(evaluateImportFileSelection(images.slice(0, 50))).toMatchObject({ accepted: images.slice(0, 50), total: 50, error: '' });
    expect(evaluateImportFileSelection(images, 0)).toMatchObject({ accepted: [], total: 51, error: 'Du kan velge maks 50 bilder per importomgang.' });
    expect(evaluateImportFileSelection(images.slice(0, 2), 49)).toMatchObject({ accepted: [], total: 51, error: 'Du kan velge maks 50 bilder per importomgang.' });
  });

  it('viser valgt bildeantall uten å gjenta maksgrensen', () => {
    expect(getImageSelectionLabel(1)).toBe('1 bilde valgt');
    expect(getImageSelectionLabel(3)).toBe('3 bilder valgt');
  });

  it('bruker én OCR-jobb på mobil og to på desktop uten å basere seg på viewport', () => {
    expect(getImportOcrConcurrency({ userAgent: 'Desktop', maxTouchPoints: 0, userAgentData: { mobile: true } })).toBe(1);
    expect(getImportOcrConcurrency({ userAgent: 'Mozilla/5.0 (Linux; Android 15)', maxTouchPoints: 5 })).toBe(1);
    expect(getImportOcrConcurrency({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15', maxTouchPoints: 5 })).toBe(1);
    expect(getImportOcrConcurrency({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0, userAgentData: { mobile: false } })).toBe(2);
  });

  it('nullstiller filinputen før Importer flere åpner filvelgeren og frigjør preview-URL', () => {
    const input = { value: 'C:\\fakepath\\samme.jpg', click: vi.fn() };
    const revoke = vi.fn();
    const [source] = createCanonicalImportSources([new File(['x'], 'samme.jpg', { type: 'image/jpeg' })], 0, () => 'blob:preview');

    openImportFilePicker(input);
    releaseImportSourcePreview(source, revoke);

    expect(input.value).toBe('');
    expect(input.click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:preview');
  });

  it('beholder Android-filreferansen etter at valget er lest, og nullstiller kun før neste åpning', () => {
    const file = new File(['bilde'], '3150.jpg', { type: 'image/jpeg' });
    const input = { files: { 0: file, length: 1, item: () => file }, value: 'content://media/3150.jpg' };

    expect(readImportFileSelection(input)).toEqual([file]);
    expect(input.value).toBe('content://media/3150.jpg');
  });

  it('bygger lokale OCR-ressursadresser fra GitHub Pages-basepath', () => {
    expect(getTesseractAssetPaths('/oddsen_tracker_v2/')).toEqual({
      workerPath: '/oddsen_tracker_v2/ocr/tesseract/worker.min.js',
      corePath: '/oddsen_tracker_v2/ocr/tesseract/core',
      langPath: '/oddsen_tracker_v2/ocr/tesseract/lang',
      workerBlobURL: false,
    });
  });

  it('viser stagespesifikke importfeil i stedet for samme språkdatafeil', () => {
    expect(getImportFailureMessage({ stage: 'decode', sourceName: '3150.jpg' }))
      .toBe('3150.jpg kunne ikke dekodes som PNG, JPG eller WEBP.');
    expect(getImportFailureMessage({ stage: 'language', sourceName: '3150.jpg' }))
      .toBe('OCR-språkdata kunne ikke lastes for 3150.jpg. Prøv igjen.');
    expect(getImportFailureMessage({ stage: 'recognize', sourceName: '3150.jpg' }))
      .toBe('Teksten i 3150.jpg kunne ikke gjenkjennes. Prøv igjen.');
  });

  it('viser rød status med eksakt antall ugyldige kort og grønn status først ved null feil', () => {
    const [first] = parseCouponText(`Kamp: Frankrike vs Spania
Starttid: 14.07.2026 21:00
Konkurranse: Internasjonal - Fotball-VM
Marked: Scorer mål
Utfall: Kylian Mbappe
Odds: 2.10
Innsats: 500
Mulig premie: 1050
Kupongnummer: 301648248.1`);
    const second = { ...first, id: crypto.randomUUID(), groupId: '301648249.1', coupon: '301648249.1', match: '' };

    expect(getImportReviewStatus([first, second])).toMatchObject({
      couponCount: 2,
      selectionCount: 2,
      invalidCardCount: 1,
      tone: 'error',
      message: '2 kuponger med 2 spillvalg til kontroll · 1 kort må rettes før lagring',
    });
    expect(getImportReviewStatus([{ ...first }, { ...second, match: 'Frankrike vs Spania' }])).toMatchObject({
      invalidCardCount: 0,
      tone: 'success',
      message: '2 kuponger med 2 spillvalg er klare til lagring',
    });
  });

  it('beholder alle OCR-ankere også når ett bilde inneholder mer enn 24 kuponger', () => {
    const lines = Array.from({ length: 25 }, (_, index) => {
      const column = index % 5;
      const row = Math.floor(index / 5);
      return {
        text: `ID ${300000000 + index}.1`,
        bbox: { x0: 40 + (column * 190), y0: 40 + (row * 190), x1: 150 + (column * 190), y1: 70 + (row * 190) },
        words: [],
      };
    });

    expect(detectOcrGridBoxes(1000, 1000, [{ paragraphs: [{ lines }] }])).toHaveLength(25);
  });

  it('avviser Oddsen og symbolstøy som deltakere ved parsing, merge og lagring', () => {
    const receipt = (match: string) => parseCouponText(`Kamp: ${match}
Starttid: 14.07.2026 21:00
Konkurranse: Internasjonal - Fotball-VM
Marked: Scorer mål
Utfall: Kylian Mbappe
Odds: 2.10
Innsats: 500
Mulig premie: 1050
Kupongnummer: 301648248.1`)[0];
    const noisy = receipt('++ Oddsen vs Spania');
    const correct = receipt('Frankrike vs Spania');

    expect(noisy.match).toBe('');
    expect(validateImportForPersistence([noisy]).ready).toEqual([]);
    const [merged] = mergePositionedWithText({ ...correct, match: 'ya > Oddsen vs Spania' }, [correct]);
    expect(merged.match).toBe('Frankrike vs Spania');
    expect(draftErrors(merged)).toEqual([]);
  });

  it('foretrekker en sikker komplett lagkandidat fremfor et avkuttet OCR-fragment', () => {
    const [correct] = parseCouponText(`Kamp: Frankrike vs Spania
Starttid: 14.07.2026 21:00
Konkurranse: Internasjonal - Fotball-VM
Marked: Halvtid/Fulltid
Utfall: Spain - France
Odds: 25
Innsats: 200
Mulig premie: 5000
Kupongnummer: 301646585.1`);

    const [merged] = mergePositionedWithText({ ...correct, match: 's sen vs Spania' }, [correct]);

    expect(merged.match).toBe('Frankrike vs Spania');
    expect(draftErrors({ ...correct, match: 's sen vs Spania' })).toContainEqual(expect.stringContaining('Kamp/event'));
  });

  it('kobler relativ tid til en kjøpsdato som OCR har delt over flere linjer', () => {
    const [item] = parseCouponText(`Oddsen
Singel
Internasjonal - Fotball-VM
Frankrike
Spania
I dag
21:00
Scorer mål
Kylian Mbappe 2.10
Odds 2.10
Innsats 500 kr
Mulig premie 1 050 kr
Dato
14. juli
2026,
15:34
ID 301648248.1`);

    expect(item).toMatchObject({
      match: 'Frankrike vs Spania',
      kickoff: '14.07.2026 21:00',
      coupon: '301648248.1',
    });
  });

  it('tåler at mobil-OCR leser I-en i I dag som en strek ved siden av laget', () => {
    const [item] = parseCouponText(`Oddsen
Singel
Internasjonal - Fotball-VM
Frankrike | dag 21:00
Spania
Halvtid/Fulltid
Spain - France 25.00
Odds 25.00
Innsats 200 kr
Mulig premie 5 000 kr
Dato 14. juli 2026, 15:23
ID 301646585.1`);

    expect(item).toMatchObject({
      match: 'Frankrike vs Spania',
      kickoff: '14.07.2026 21:00',
      coupon: '301646585.1',
    });
    expect(draftErrors(item)).toEqual([]);
  });

  it('bruker sikre laglinjer og tåler tegnstøy i relativ tid og splittet kjøpsdato', () => {
    const line = (text: string, y: number, x0 = 20, x1 = 260) => ({ text, bbox: { x0, y0: y, x1, y1: y + 9 } });
    const blocks = [{ paragraphs: [{ lines: [
      line('ya > Oddsen', 0), line('Singel', 15), line('& Internasjonal - Fotball-VM', 30),
      line('Frankrike', 45), line('Spania', 60, 20, 100), line('I dag · 21 : 00', 60, 180, 300),
      line('Scorer 2 eller flere mål', 78), line('Kylian Mbappe 7.50', 92),
      line('Odds 7.50', 120), line('Innsats 100 kr', 136), line('Mulig premie 750 kr', 152),
      line('Dato', 170), line('14. juli 2026,', 184), line('15:34', 198), line('ID 301648357.1', 214),
    ] }] }];

    const item = parsePositionedCoupon(blocks);
    expect(item).toMatchObject({
      match: 'Frankrike vs Spania', kickoff: '14.07.2026 21:00',
      competition: 'Internasjonal - Fotball-VM', coupon: '301648357.1',
      market: 'Scorer 2 eller flere mål', selection: 'Kylian Mbappe',
      odds: '7.5', stake: '100', payout: '750',
    });
    expect(draftErrors(item!)).toEqual([]);
  });

  it('kobler relativ tid til en posisjonert kjøpsdato uten Dato-etikett', () => {
    const line = (text: string, y: number, x0 = 20, x1 = 260) => ({ text, bbox: { x0, y0: y, x1, y1: y + 9 } });
    const blocks = [{ paragraphs: [{ lines: [
      line('Singel', 0), line('Internasjonal - Fotball-VM', 15),
      line('Frankrike', 30), line('Spania', 45, 20, 100), line('I dag 21:00', 45, 180, 300),
      line('Scorer mål', 64), line('Kylian Mbappe 2.10', 78),
      line('Odds 2.10', 105), line('Innsats 500 kr', 119), line('Mulig premie 1 050 kr', 133),
      line('14. juli', 153), line('2026,', 167), line('15:34', 181), line('ID 301648248.1', 195),
    ] }] }];

    const item = parsePositionedCoupon(blocks);

    expect(item).toMatchObject({
      match: 'Frankrike vs Spania',
      kickoff: '14.07.2026 21:00',
      coupon: '301648248.1',
    });
    expect(draftErrors(item!)).toEqual([]);
  });

  it('gjetter ikke år når kupongen mangler sikker referansedato', () => {
    const [item] = parseCouponText(`Kamp: Frankrike vs Spania
Starttid: 14/7 21:00
Konkurranse: Internasjonal - Fotball-VM
Marked: Scorer mål
Utfall: Kylian Mbappe
Odds: 2.10
Innsats: 500
Mulig premie: 1050
Kupongnummer: 301648248.1`);

    expect(item.kickoff).toBe('');
    expect(draftErrors(item)).toContain('Starttid må være på formatet DD.MM.YYYY HH:MM.');
  });

  it('avviser turneringsnavnet som kamp for vanlige markeder', () => {
    const [item] = parseCouponText(`Kamp: & Internasjonal - Fotball-VM
Starttid: 14.07.2026 21:00
Konkurranse: Internasjonal - Fotball-VM
Marked: Scorer mål
Utfall: Kylian Mbappe
Odds: 2.10
Innsats: 500
Mulig premie: 1050
Kupongnummer: 301648248.1`);

    expect(item.match).toBe('');
    expect(draftErrors(item)).toContainEqual(expect.stringContaining('Bruk lagene'));
  });

  it.each([
    ['England v\nArgentina', 'England vs Argentina'],
    ['Paris Saint-Germain\nvs\nManchester United Football Club', 'Paris Saint-Germain vs Manchester United Football Club'],
    ['Club Atletico de San Luis mot\nNew York City Football Club', 'Club Atletico de San Luis vs New York City Football Club'],
    ['England v Argentina', 'England vs Argentina'],
    ['Real Madrid Club de Futbol -\nBorussia Monchengladbach', 'Real Madrid Club de Futbol vs Borussia Monchengladbach'],
    ['FC Kobenhavn\n- Rosenborg Ballklub', 'FC Kobenhavn vs Rosenborg Ballklub'],
    ['England-\nArgentina', 'England vs Argentina'],
    ['England\n-Argentina', 'England vs Argentina'],
  ])('rekonstruerer kamp rundt tilfeldige OCR-linjeskift: %s', (eventLines, expected) => {
    const [item] = parseCouponText(`Innsats: 100,00
Odds: 2.50
Mulig Premie: 250,00
1. ${eventLines}
Starttid: Fre. 10/7 21:00
Konkurranse: Internasjonal - Fotball-VM
Spillobjekt: Kampvinner
Spilt utfall: Ja
Levert: 10.07.2026
Kupongnummer: 399999991.1`);

    expect(item.match).toBe(expected);
  });

  it('rekonstruerer nummerert kamp også i posisjonert OCR', () => {
    const row = (text: string, y: number) => ({ text, bbox: { x0: 20, y0: y, x1: 330, y1: y + 12 } });
    const item = parsePositionedCoupon([{ paragraphs: [{ lines: [
      row('Innsats: 100,00', 10), row('Odds: 2.50', 28), row('Mulig Premie: 250,00', 46),
      row('1. England v', 80), row('Argentina', 98), row('Starttid:', 120), row('Fre. 10/7 21:00', 138),
      row('Konkurranse:', 160), row('Internasjonal - Fotball-VM', 178), row('Spillobjekt:', 200),
      row('Kampvinner', 218), row('Spilt utfall:', 240), row('Ja', 258), row('Levert: 10.07.2026', 280),
      row('Kupongnummer: 399999992.1', 300),
    ] }] }]);

    expect(item?.match).toBe('England vs Argentina');
  });

  it('beholder alle ti England–Argentina-kuponger i OCR-tekstflyten', () => {
    const receipts = Array.from({ length: 10 }, (_, index) => `Innsats: 100,00
Odds: 2.50
Mulig Premie: 250,00
1. England v
Argentina
Starttid: Fre. 10/7 21:00
Konkurranse: Internasjonal - Fotball-VM
Spillobjekt: Kampvinner
Spilt utfall: Ja
Levert: 10.07.2026
Kupongnummer: ${399999900 + index}.1`).join('\n\n');

    const items = parseCouponText(receipts);

    expect(items).toHaveLength(10);
    expect(items.every((item) => item.match === 'England vs Argentina')).toBe(true);
  });

  it('sorterer tallkolonner stabilt uten å endre lagret rekkefølge', () => {
    const bet = (id: string, odds: number, stake: number, payout: number): TrackedBet => ({
      id, couponGroupId: id, match: 'England vs Argentina', kickoff: '10.07.2026 21:00',
      competition: 'Internasjonal - Fotball-VM', coupon: id, category: 'Kamp', market: 'Kampvinner',
      selection: 'Ja', odds, stake, payout,
    });
    const stored = [bet('a', 2.5, 100, 250), bet('b', 4.2, 300, 1260), bet('c', 2.5, 200, 500)];

    expect(sortBetsForDisplay(stored, { key: 'odds', direction: 'desc' }).map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(sortBetsForDisplay(stored, { key: 'odds', direction: 'asc' }).map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(sortBetsForDisplay(stored, { key: 'stake', direction: 'desc' }).map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(sortBetsForDisplay(stored, { key: 'payout', direction: 'asc' }).map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(stored.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('starter automatisk sortering synkende og veksler bare det valgte feltet', () => {
    const descending = nextBetSort(undefined, 'odds');
    expect(descending).toEqual({ key: 'odds', direction: 'desc' });
    expect(nextBetSort(descending, 'odds')).toEqual({ key: 'odds', direction: 'asc' });
    expect(nextBetSort({ key: 'stake', direction: 'asc' }, 'payout')).toEqual({ key: 'payout', direction: 'desc' });
  });

  it('materialiserer bare aktuelt kampkort når dragging går tilbake til manuell rekkefølge', () => {
    const bet = (id: string, match: string, odds: number): TrackedBet => ({
      id, couponGroupId: id, match, kickoff: '10.07.2026 21:00', competition: 'VM', coupon: id,
      category: 'Kamp', market: 'Kampvinner', selection: 'Ja', odds, stake: 100, payout: odds * 100,
    });
    const stored = [bet('a', 'England vs Argentina', 2), bet('x', 'Norge vs Spania', 8), bet('b', 'England vs Argentina', 4)];

    expect(materializeMatchSort(stored, 'England vs Argentina', { key: 'odds', direction: 'desc' }).map((item) => item.id))
      .toEqual(['b', 'x', 'a']);
    expect(stored.map((item) => item.id)).toEqual(['a', 'x', 'b']);
  });
});
