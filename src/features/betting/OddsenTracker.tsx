import {
  useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type DragEvent, type KeyboardEvent,
} from 'react';
import {
  Check, ChevronLeft, FileText, GripVertical, Image as ImageIcon, Loader2, Moon, Plus,
  Sun, Trash2, Trophy, Upload, X,
} from 'lucide-react';
import { createWorker } from 'tesseract.js';
import heroImage from '../../assets/world-cup-stadium-hero.png';
import './oddsen-tracker.css';

type Theme = 'dark' | 'light';
type Category = 'Kamp' | 'Spiller' | 'Timing' | 'Resultat' | 'Statistikk' | 'Spesial';
type ImportMode = 'image' | 'text';
type ImportStep = 'source' | 'review' | 'success';

interface TrackedBet {
  id: string;
  couponGroupId: string;
  match: string;
  kickoff: string;
  competition: string;
  coupon: string;
  category: Category;
  market: string;
  selection: string;
  odds: number;
  stake: number;
  payout: number;
}

interface ImportDraft {
  id: string;
  groupId: string;
  match: string;
  kickoff: string;
  competition: string;
  coupon: string;
  category: Category;
  market: string;
  selection: string;
  odds: string;
  stake: string;
  payout: string;
  sourceName?: string;
  sourcePreview?: string;
}

interface UploadFile { file: File; url: string; }

const CATEGORIES: Array<'Alle' | Category> = ['Alle', 'Kamp', 'Spiller', 'Timing', 'Resultat', 'Statistikk', 'Spesial'];
const categoryCode: Record<Category, string> = { Kamp: 'K', Spiller: 'SP', Timing: 'TID', Resultat: '1X2', Statistikk: 'STAT', Spesial: 'VIP' };
const categoryClass: Record<Category, string> = { Kamp: 'match', Spiller: 'player', Timing: 'timing', Resultat: 'result', Statistikk: 'stats', Spesial: 'special' };
const money = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });
const STORAGE_KEY = 'oddsen-tracker:workspace-v6';

function clean(value = '') {
  return String(value).replace(/[|]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s:.-]+|[\s:.-]+$/g, '').trim();
}

function numberFrom(value: unknown) {
  let normalized = String(value ?? '').replace(/kr/gi, '').replace(/\s/g, '');
  if (normalized.includes(',')) normalized = normalized.replace(/\./g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function oddsFrom(value: unknown) {
  const raw = String(value ?? '').replace(/kr/gi, '').trim();
  const spacedDecimal = raw.match(/^(\d{1,3})\s+(\d{2})$/);
  if (spacedDecimal) return Number(`${spacedDecimal[1]}.${spacedDecimal[2]}`);
  const parsed = numberFrom(raw);
  if (/^\d{3,4}$/.test(raw.replace(/\s/g, '')) && parsed > 100) return parsed / 100;
  return parsed;
}

function inferCategory(market = ''): Category {
  const value = market.toLowerCase();
  if (/begge lag|totalt antall|over\s*\/?\s*under|\bhub\b/.test(value)) return 'Kamp';
  if (/scorer|spiller|assist|heading|hat.?trick/.test(value)) return 'Spiller';
  if (/tidspunkt|minutt|første mål/.test(value)) return 'Timing';
  if (/kort|corner|hjørne|takling|skudd|statistikk/.test(value)) return 'Statistikk';
  if (/korrekt resultat|kampvinner|resultat|1x2|omgang/.test(value)) return 'Resultat';
  if (/vinner.*vm|mester|turnering|toppscorer|spesial/.test(value)) return 'Spesial';
  return 'Kamp';
}

function draft(): ImportDraft {
  return { id: crypto.randomUUID(), groupId: crypto.randomUUID(), match: '', kickoff: '', competition: 'Fotball-VM 2026', coupon: '', category: 'Kamp', market: '', selection: '', odds: '', stake: '', payout: '' };
}

export function parseCouponText(rawText: string, sourceName?: string, sourcePreview?: string): ImportDraft[] {
  const text = String(rawText || '')
    .replace(/\r/g, '')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/Mulig\s+Premie/gi, 'Mulig Premie')
    .replace(/\s+(?=\d{1,2}[.)]?\s+[^:\n]{2,100}\s+(?:Starttid|Konkurranse|Spillobjekt)\s*:)/gi, '\n')
    .replace(/\s+(?=(?:Starttid|Konkurranse|Spillobjekt|Spilt\s+utfall|Levert|Kupongnummer)\s*:)/gi, '\n');
  const summaryPattern = /innsats\s*:?\s*([0-9]+(?:[ .][0-9]{3})*(?:,[0-9]{1,2})?)[\s\S]{0,300}?\bOdds\s*:?\s*([0-9]+(?:(?:[.,]|\s)[0-9]{1,2})?)[\s\S]{0,300}?Mulig\s+Premie\s*:?\s*([0-9]+(?:[ .][0-9]{3})*(?:,[0-9]{1,2})?)/gi;
  const summaries = [...text.matchAll(summaryPattern)];

  if (summaries.length) return summaries.flatMap((summary, index): ImportDraft[] => {
    const block = text.slice(summary.index, summaries[index + 1]?.index ?? text.length);
    const coupon = clean(block.match(/Kupongnummer\s*:?\s*([0-9.]+)/i)?.[1] || '');
    const groupId = coupon || crypto.randomUUID();
    const stake = String(numberFrom(summary[1]) || ''); const payout = String(numberFrom(summary[3]) || '');
    const markers = [...block.matchAll(/(?:^|\n)\s*\d{1,2}[.)]?\s+([^\n]{2,100})/gm)];
    const parseSection = (section: string, fallbackMatch = 'Importert kupong'): ImportDraft => {
      const market = clean(section.match(/Spillobjekt\s*:?\s*([\s\S]*?)(?=\s*Spilt\s+utfall)/i)?.[1] || section.match(/Marked\s*:?\s*([^\n]+)/i)?.[1] || 'Spillmarked');
      let selection = clean(section.match(/Spilt\s+utfall\s*:?\s*([\s\S]*?)(?=\s*(?:Levert|Kupongnummer|\n\s*\d+\.|$))/i)?.[1] || section.match(/Utfall\s*:?\s*([^\n]+)/i)?.[1] || '');
      const selectionOdds = selection.match(/\s+([0-9]+(?:(?:[.,]|\s)[0-9]{1,2})?)$/);
      const odds = oddsFrom(summary[2]);
      if (selectionOdds) {
        const legOdds = oddsFrom(selectionOdds[1]);
        selection = selection.slice(0, selectionOdds.index).trim();
        if (markers.length > 1 && legOdds > 1) selection = `${selection} · delodds ${legOdds.toFixed(2)}`;
      }
      const match = clean(section.match(/(?:^|\n)\s*\d{1,2}[.)]?\s+([^\n]{2,100})/m)?.[1] || section.match(/Kamp\s*:?\s*([^\n]+)/i)?.[1] || fallbackMatch);
      const kickoff = clean(section.match(/Starttid\s*:?\s*([\s\S]*?)(?=\s*(?:Konkurranse|Spillobjekt))/i)?.[1] || section.match(/Kampstart\s*:?\s*([^\n]+)/i)?.[1] || 'Tidspunkt ikke oppgitt');
      const competition = clean(section.match(/Konkurranse\s*:?\s*([\s\S]*?)(?=\s*Spillobjekt)/i)?.[1] || 'Fotball-VM 2026');
      return { id: crypto.randomUUID(), groupId, match, kickoff, competition, coupon, category: inferCategory(market), market, selection, odds: String(odds || ''), stake, payout, sourceName, sourcePreview };
    };
    if (markers.length <= 1) return [parseSection(block)];
    return markers.map((marker, markerIndex) => parseSection(block.slice(marker.index, markers[markerIndex + 1]?.index ?? block.length), clean(marker[1])));
  });

  return text.split(/\n\s*---+\s*\n/).flatMap((block): ImportDraft[] => {
    const market = clean(block.match(/(?:Spillobjekt|Marked)\s*:?\s*([^\n]+)/i)?.[1] || '');
    const selection = clean(block.match(/(?:Spilt\s+utfall|Utfall|Spillvalg)\s*:?\s*([^\n]+)/i)?.[1] || '');
    const stake = numberFrom(block.match(/Innsats\s*:?\s*([^\n]+)/i)?.[1]);
    const odds = oddsFrom(block.match(/Odds\s*:?\s*([^\n]+)/i)?.[1]);
    if (!market && !selection && !stake && !odds) return [];
    const item = draft();
    return [{ ...item, sourceName, sourcePreview, market, selection, category: inferCategory(market), match: clean(block.match(/Kamp\s*:?\s*([^\n]+)/i)?.[1] || 'Importert kupong'), kickoff: clean(block.match(/(?:Starttid|Kampstart)\s*:?\s*([^\n]+)/i)?.[1] || 'Tidspunkt ikke oppgitt'), odds: String(odds || ''), stake: String(stake || ''), payout: String(numberFrom(block.match(/Mulig\s+premie\s*:?\s*([^\n]+)/i)?.[1]) || (stake * odds) || '') }];
  });
}

interface CouponBox { x: number; y: number; width: number; height: number; }
interface PixelImage { width: number; height: number; data: Uint8ClampedArray; }
interface CouponRegion { blob: Blob; previewUrl: string; box: CouponBox; sourceName: string; }

function runs(values: number[], predicate: (value: number) => boolean, minimum: number) {
  const result: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let index = 0; index <= values.length; index += 1) {
    if (index < values.length && predicate(values[index])) { if (start < 0) start = index; continue; }
    if (start >= 0 && index - start >= minimum) result.push({ start, end: index });
    start = -1;
  }
  return result;
}

function mergeNearby(items: Array<{ start: number; end: number }>, gap: number) {
  return items.reduce<Array<{ start: number; end: number }>>((all, item) => {
    const previous = all.at(-1);
    if (previous && item.start - previous.end <= gap) previous.end = item.end;
    else all.push({ ...item });
    return all;
  }, []);
}

function isPaper(data: Uint8ClampedArray, offset: number) {
  const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
  return r > 242 && g > 242 && b > 242 && Math.max(r, g, b) - Math.min(r, g, b) < 22;
}

export function detectCouponBoxes(image: PixelImage): CouponBox[] {
  const { width, height, data } = image;
  const yStart = Math.floor(height * .025); const yEnd = Math.ceil(height * .975);
  const yStep = Math.max(1, Math.floor(height / 1000));
  const columnScores = Array.from({ length: width }, (_, x) => {
    let paper = 0; let samples = 0;
    for (let y = yStart; y < yEnd; y += yStep) { if (isPaper(data, ((y * width) + x) * 4)) paper += 1; samples += 1; }
    return paper / Math.max(1, samples);
  });
  let columns = mergeNearby(runs(columnScores, (score) => score > .055, Math.max(18, Math.floor(width * .11))), 0);
  if (!columns.length) columns = [{ start: 0, end: width }];

  const boxes = columns.flatMap((column) => {
    const xStart = Math.max(0, column.start + Math.floor((column.end - column.start) * .015));
    const xEnd = Math.min(width, column.end - Math.floor((column.end - column.start) * .015));
    const xStep = Math.max(1, Math.floor((xEnd - xStart) / 80));
    const rowScores = Array.from({ length: height }, (_, y) => {
      let paper = 0; let samples = 0;
      for (let x = xStart; x < xEnd; x += xStep) { if (isPaper(data, ((y * width) + x) * 4)) paper += 1; samples += 1; }
      return paper / Math.max(1, samples);
    });
    const rows = mergeNearby(runs(rowScores, (score) => score > .42, Math.max(40, Math.floor(height * .035))), Math.max(3, Math.floor(height * .004)));
    return rows.map((row) => {
      const pad = Math.max(3, Math.floor(width * .003));
      const x = Math.max(0, column.start - pad); const y = Math.max(0, row.start - pad);
      return { x, y, width: Math.min(width - x, column.end - column.start + pad * 2), height: Math.min(height - y, row.end - row.start + pad * 2) };
    }).filter((box) => box.width >= width * .1 && box.height >= height * .03);
  });
  const detected = boxes.length ? boxes : [{ x: 0, y: 0, width, height }];
  const refined = detected.flatMap((box) => {
    const ratio = box.width / Math.max(1, box.height);
    if (ratio < 1.55) return [box];
    const count = Math.max(2, Math.min(5, Math.round(ratio / .78)));
    const cellWidth = box.width / count;
    return Array.from({ length: count }, (_, index) => {
      const x = Math.round(box.x + index * cellWidth);
      const nextX = Math.round(box.x + (index + 1) * cellWidth);
      return { x, y: box.y, width: nextX - x, height: box.height };
    });
  });
  return refined.sort((a, b) => {
    const sameRow = Math.abs(a.y - b.y) < Math.min(a.height, b.height) * .35;
    return sameRow ? a.x - b.x : a.y - b.y;
  });
}

async function segmentCouponImage(file: File): Promise<CouponRegion[]> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Canvas er ikke tilgjengelig.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0);
  const boxes = detectCouponBoxes(context.getImageData(0, 0, canvas.width, canvas.height));
  const regions: CouponRegion[] = [];
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index]; const scale = Math.min(2.5, Math.max(1, 980 / box.width));
    const crop = document.createElement('canvas'); crop.width = Math.round(box.width * scale); crop.height = Math.round(box.height * scale);
    const cropContext = crop.getContext('2d', { alpha: false }); if (!cropContext) continue;
    cropContext.fillStyle = '#fff'; cropContext.fillRect(0, 0, crop.width, crop.height); cropContext.imageSmoothingEnabled = true; cropContext.imageSmoothingQuality = 'high';
    cropContext.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, crop.width, crop.height);
    const blob = await new Promise<Blob>((resolve, reject) => crop.toBlob((value) => value ? resolve(value) : reject(new Error('Kunne ikke opprette bildeutdrag.')), 'image/png'));
    regions.push({ blob, previewUrl: crop.toDataURL('image/jpeg', .86), box, sourceName: `${file.name} · utsnitt ${index + 1}` });
  }
  bitmap.close();
  return regions;
}

interface OcrBox { x0: number; y0: number; x1: number; y1: number; }
interface OcrWord { text: string; bbox: OcrBox; }
interface OcrLine { text: string; bbox: OcrBox; words?: OcrWord[]; }
interface OcrBlock { paragraphs?: Array<{ lines?: OcrLine[] }>; }

function clusterCoordinates(values: number[], tolerance: number) {
  const clusters: number[][] = [];
  [...values].sort((a, b) => a - b).forEach((value) => {
    const target = clusters.find((cluster) => Math.abs((cluster.reduce((sum, item) => sum + item, 0) / cluster.length) - value) <= tolerance);
    if (target) target.push(value); else clusters.push([value]);
  });
  return clusters.map((cluster) => cluster.reduce((sum, item) => sum + item, 0) / cluster.length).sort((a, b) => a - b);
}

function dedupeAnchors(anchors: OcrBox[], width: number, height: number) {
  return anchors.reduce<OcrBox[]>((all, anchor) => {
    const x = (anchor.x0 + anchor.x1) / 2; const y = (anchor.y0 + anchor.y1) / 2;
    const duplicate = all.some((item) => Math.abs(((item.x0 + item.x1) / 2) - x) < width * .08 && Math.abs(((item.y0 + item.y1) / 2) - y) < height * .06);
    if (!duplicate) all.push(anchor);
    return all;
  }, []);
}

async function cropRegion(region: CouponRegion, box: CouponBox, suffix: string): Promise<CouponRegion> {
  const bitmap = await createImageBitmap(region.blob);
  const crop = document.createElement('canvas'); crop.width = Math.max(1, Math.round(box.width)); crop.height = Math.max(1, Math.round(box.height));
  const context = crop.getContext('2d', { alpha: false }); if (!context) { bitmap.close(); throw new Error('Canvas er ikke tilgjengelig.'); }
  context.fillStyle = '#fff'; context.fillRect(0, 0, crop.width, crop.height); context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, crop.width, crop.height); bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => crop.toBlob((value) => value ? resolve(value) : reject(new Error('Kunne ikke opprette kupongutdrag.')), 'image/png'));
  return { blob, previewUrl: crop.toDataURL('image/jpeg', .9), box, sourceName: `${region.sourceName} · ${suffix}` };
}

export function detectOcrGridBoxes(width: number, height: number, blocks: unknown): CouponBox[] {
  const lines = ((blocks || []) as OcrBlock[]).flatMap((block) => block.paragraphs || []).flatMap((paragraph) => paragraph.lines || []);
  const words = lines.flatMap((line) => line.words || []);
  const candidates = [
    { kind: 'coupon', anchors: words.filter((word) => /kupong|kupongnr|kupongnummer/i.test(word.text)).map((word) => word.bbox) },
    { kind: 'stake', anchors: words.filter((word) => /oddsen/i.test(word.text)).map((word) => word.bbox) },
    { kind: 'stake', anchors: words.filter((word) => /innsats/i.test(word.text)).map((word) => word.bbox) },
    { kind: 'match', anchors: lines.filter((line) => /(?:^|\s)1[.)]\s+.+\s(?:v|vs\.?|mot)\s/i.test(line.text)).map((line) => line.bbox) },
  ].map((candidate) => ({ ...candidate, anchors: dedupeAnchors(candidate.anchors, width, height) })).sort((a, b) => b.anchors.length - a.anchors.length);
  const selected = candidates[0];
  const anchors = selected?.anchors || [];
  if (anchors.length < 2) return [];

  const centers = anchors.map((anchor) => ({ x: (anchor.x0 + anchor.x1) / 2, y: (anchor.y0 + anchor.y1) / 2 }));
  const columns = clusterCoordinates(centers.map((center) => center.x), width * .16);
  if (columns.length < 1 || anchors.length > 24) return [];

  const boundaries = (centersList: number[], maximum: number) => centersList.map((center, index) => ({
    start: index === 0 ? 0 : Math.round((centersList[index - 1] + center) / 2),
    end: index === centersList.length - 1 ? maximum : Math.round((center + centersList[index + 1]) / 2),
  }));
  const xBounds = boundaries(columns, width);
  const cells: CouponBox[] = [];
  for (let column = 0; column < xBounds.length; column += 1) {
    const rows = clusterCoordinates(centers.filter((center) => {
      const closest = columns.reduce((best, candidate, index) => Math.abs(candidate - center.x) < Math.abs(columns[best] - center.x) ? index : best, 0);
      return closest === column;
    }).map((center) => center.y), height * .085);
    if (!rows.length) continue;
    let yBounds = boundaries(rows, height);
    if (selected.kind === 'coupon') {
      const ends = rows.map((center, index) => index === rows.length - 1 ? height : Math.min(height, Math.round(center + (rows[index + 1] - center) * .08)));
      yBounds = rows.map((_, index) => ({ start: index === 0 ? 0 : ends[index - 1], end: ends[index] }));
    } else if (selected.kind === 'stake') {
      const starts = rows.map((center, index) => index === 0 ? 0 : Math.max(0, Math.round(center - (center - rows[index - 1]) * .13)));
      yBounds = rows.map((_, index) => ({ start: starts[index], end: index === rows.length - 1 ? height : starts[index + 1] }));
    }
    const x = xBounds[column];
    yBounds.forEach((y) => cells.push({ x: x.start, y: y.start, width: x.end - x.start, height: y.end - y.start }));
  }
  return cells.sort((a, b) => {
    const sameRow = Math.abs(a.y - b.y) < Math.min(a.height, b.height) * .35;
    return sameRow ? a.x - b.x : a.y - b.y;
  });
}

async function splitRegionByOcrAnchors(region: CouponRegion, blocks: unknown): Promise<CouponRegion[]> {
  const bitmap = await createImageBitmap(region.blob); const width = bitmap.width; const height = bitmap.height; bitmap.close();
  const boxes = detectOcrGridBoxes(width, height, blocks);
  if (boxes.length < 2) return [region];
  const cells: CouponRegion[] = [];
  for (let index = 0; index < boxes.length; index += 1) cells.push(await cropRegion(region, boxes[index], `kort ${index + 1}`));
  return cells;
}

export function draftErrors(item: ImportDraft) {
  const errors: string[] = [];
  const suspicious = /\b(?:Spillobjekt|Spilt\s+utfall|Kupongnummer|Konkurranse|Mulig\s+premie|Innsats|Odds)\b/i;
  if (!clean(item.match) || item.match.length > 110 || suspicious.test(item.match)) errors.push('Kampnavnet er mangelfullt eller inneholder sammenslått OCR-tekst.');
  if (!clean(item.market) || item.market.length > 130 || /Spilt\s+utfall|Kupongnummer|Mulig\s+premie/i.test(item.market)) errors.push('Markedet må kontrolleres.');
  if (!clean(item.selection) || item.selection.length > 180 || suspicious.test(item.selection)) errors.push('Spillvalget må kontrolleres.');
  if (item.kickoff.length > 80 || /Konkurranse|Spillobjekt/i.test(item.kickoff)) errors.push('Starttiden inneholder ugyldig tekst.');
  if (item.competition.length > 100 || /Spillobjekt|Spilt\s+utfall/i.test(item.competition)) errors.push('Turneringsnavnet må kontrolleres.');
  const odds = oddsFrom(item.odds); const stake = numberFrom(item.stake); const payout = numberFrom(item.payout);
  if (!(odds > 1 && odds < 1000)) errors.push('Odds må være et tall mellom 1 og 1000.');
  if (!(stake > 0 && stake < 1_000_000)) errors.push('Innsats mangler eller er ugyldig.');
  if (!(payout > 0)) errors.push('Mulig premie mangler eller er ugyldig.');
  if (odds > 1 && stake > 0 && payout > 0 && Math.abs((odds * stake) - payout) > Math.max(2, payout * .06)) errors.push('Innsats × odds stemmer ikke med mulig premie.');
  return [...new Set(errors)];
}

function readStoredBets(): TrackedBet[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as TrackedBet[];
    return parsed.filter((bet) => bet.match?.length <= 110 && bet.market?.length <= 130 && bet.selection?.length <= 180 && bet.odds > 1 && bet.stake > 0 && bet.payout > 0);
  }
  catch { return []; }
}

function teamCodes(label: string) {
  const parts = label.split(/\s+(?:v|vs\.?|mot)\s+/i);
  const code = (name: string) => name.replace(/[^A-Za-zÆØÅæøå]/g, '').slice(0, 3).toUpperCase() || 'VM';
  return parts.length > 1 ? { home: code(parts[0]), away: code(parts[1]), special: false } : { home: 'VM', away: '26', special: true };
}

function couponKey(bet: TrackedBet) { return bet.coupon || bet.couponGroupId || bet.id; }

function trackedSummary(items: TrackedBet[]) {
  const coupons = new Map<string, TrackedBet>();
  items.forEach((bet) => { if (!coupons.has(couponKey(bet))) coupons.set(couponKey(bet), bet); });
  const unique = [...coupons.values()];
  return {
    coupons: unique.length,
    stake: unique.reduce((sum, bet) => sum + bet.stake, 0),
    payout: unique.reduce((sum, bet) => sum + bet.payout, 0),
    highest: unique.reduce((max, bet) => Math.max(max, bet.odds), 0),
    averageOdds: unique.length ? unique.reduce((sum, bet) => sum + bet.odds, 0) / unique.length : 0,
  };
}

export function OddsenTracker() {
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('oddsen-tracker:theme') === 'light' ? 'light' : 'dark');
  const [bets, setBets] = useState<TrackedBet[]>(readStoredBets);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [filters, setFilters] = useState<Record<string, 'Alle' | Category>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('image');
  const [importStep, setImportStep] = useState<ImportStep>('source');
  const [importText, setImportText] = useState('');
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [detectedRegions, setDetectedRegions] = useState(0);
  const [importError, setImportError] = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const [appendImport, setAppendImport] = useState(false);

  useEffect(() => { localStorage.setItem('oddsen-tracker:theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(bets)); }, [bets]);

  const totals = useMemo(() => trackedSummary(bets), [bets]);
  const matchGroups = useMemo(() => [...new Set(bets.map((bet) => bet.match))].map((match) => ({ match, bets: bets.filter((bet) => bet.match === match) })), [bets]);
  const chosen = bets.filter((bet) => selected.has(bet.id));
  const chosenSummary = trackedSummary(chosen);
  const selectedStake = chosenSummary.stake;
  const selectedPayout = chosenSummary.payout;
  const draftCouponCount = new Set(drafts.map((item) => item.coupon || item.groupId)).size;

  function toggleBet(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLElement>, id: string) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); toggleBet(id);
  }

  function beginDrag(event: DragEvent<HTMLElement>, id: string) {
    setDraggedId(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id);
  }

  function markDrop(event: DragEvent<HTMLElement>, id: string) {
    if (!draggedId || draggedId === id) return;
    const dragged = bets.find((bet) => bet.id === draggedId); const target = bets.find((bet) => bet.id === id);
    if (!dragged || !target || dragged.match !== target.match) return;
    event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({ id, edge: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' });
  }

  function finishDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!draggedId || !dropTarget || draggedId === dropTarget.id) return endDrag();
    setBets((current) => {
      const moved = current.find((bet) => bet.id === draggedId); if (!moved) return current;
      const remaining = current.filter((bet) => bet.id !== draggedId); const targetIndex = remaining.findIndex((bet) => bet.id === dropTarget.id);
      if (targetIndex < 0) return current; const insertAt = targetIndex + (dropTarget.edge === 'after' ? 1 : 0);
      return [...remaining.slice(0, insertAt), moved, ...remaining.slice(insertAt)];
    });
    setSettlingId(draggedId); window.setTimeout(() => setSettlingId(null), 360); endDrag();
  }

  function endDrag() { setDraggedId(null); setDropTarget(null); }
  function removeCoupon(key: string) {
    const ids = bets.filter((bet) => couponKey(bet) === key).map((bet) => bet.id);
    setBets((all) => all.filter((bet) => couponKey(bet) !== key));
    setSelected((all) => { const next = new Set(all); ids.forEach((id) => next.delete(id)); return next; });
  }

  function removeMatch(match: string) {
    const ids = bets.filter((bet) => bet.match === match).map((bet) => bet.id);
    setBets((all) => all.filter((bet) => bet.match !== match));
    setSelected((all) => { const next = new Set(all); ids.forEach((id) => next.delete(id)); return next; });
    setFilters((all) => { const next = { ...all }; delete next[match]; return next; });
  }

  function removeAllCoupons() {
    setBets([]);
    setSelected(new Set());
  }

  function resetImportSource() {
    uploadFiles.forEach((item) => URL.revokeObjectURL(item.url));
    setUploadFiles([]);
    setImportText('');
    setImportError('');
    setOcrProgress(0);
    setDetectedRegions(0);
  }

  function openImport(mode: ImportMode = 'image') {
    setImportMode(mode);
    setImportOpen(true);
    setImportStep('source');
    setAppendImport(false);
    setImportError('');
    setDetectedRegions(0);
  }

  function closeImport() {
    resetImportSource();
    setDrafts([]);
    setAppendImport(false);
    setImportOpen(false);
  }

  function returnToImportSource() {
    resetImportSource();
    setAppendImport(false);
    setImportStep('source');
  }

  function beginAdditionalImport() {
    const preserveCurrentDrafts = importStep === 'review';
    resetImportSource();
    if (!preserveCurrentDrafts) setDrafts([]);
    setAppendImport(preserveCurrentDrafts);
    setImportMode('image');
    setImportStep('source');
  }

  function acceptImportedDrafts(items: ImportDraft[]) {
    setDrafts((current) => appendImport ? [...current, ...items] : items);
    setAppendImport(false);
    setImportStep('review');
    setImportError('');
  }

  function addFiles(files: FileList | File[]) {
    const images = [...files].filter((file) => file.type.startsWith('image/')).slice(0, Math.max(0, 8 - uploadFiles.length));
    if (!images.length) return setImportError('Velg PNG-, JPG- eller WEBP-bilder.');
    setUploadFiles((all) => [...all, ...images.map((file) => ({ file, url: URL.createObjectURL(file) }))]); setImportError('');
  }

  async function processSource() {
    if (importMode === 'text') {
      const parsed = parseCouponText(importText, 'Innlimt tekst');
      if (!parsed.length) return setImportError('Fant ingen komplette kuponger. Kontroller teksten eller velg «Registrer manuelt».');
      acceptImportedDrafts(parsed); return;
    }
    if (!uploadFiles.length || ocrBusy) return setImportError('Legg til minst ett skjermbilde først.');
    setOcrBusy(true); setImportError(''); setOcrProgress(0);
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    try {
      const initialRegions: CouponRegion[] = [];
      for (const item of uploadFiles) initialRegions.push(...await segmentCouponImage(item.file));
      if (!initialRegions.length) throw new Error('Ingen kupongområder ble funnet.');
      let activeRegionIndex = 0;
      let progressTotal = initialRegions.length;
      worker = await createWorker('nor+eng', 1, { logger: (message) => { if (message.status === 'recognizing text') setOcrProgress((activeRegionIndex + message.progress) / Math.max(1, progressTotal)); } });
      const finalRegions: CouponRegion[] = [];
      const cachedText = new Map<Blob, string>();
      for (let index = 0; index < initialRegions.length; index += 1) {
        activeRegionIndex = index;
        const region = initialRegions[index];
        const preliminary = await worker.recognize(region.blob, {}, { blocks: true });
        const split = await splitRegionByOcrAnchors(region, preliminary.data.blocks);
        if (split.length > 1) finalRegions.push(...split);
        else { finalRegions.push(region); cachedText.set(region.blob, preliminary.data.text); }
      }
      setDetectedRegions(finalRegions.length);
      progressTotal = finalRegions.length;
      const found: ImportDraft[] = [];
      for (let index = 0; index < finalRegions.length; index += 1) {
        activeRegionIndex = index;
        const region = finalRegions[index];
        const text = cachedText.get(region.blob) ?? (await worker.recognize(region.blob)).data.text;
        const parsed = parseCouponText(text, region.sourceName, region.previewUrl);
        if (parsed.length) found.push(...parsed);
        else found.push({ ...draft(), sourceName: region.sourceName, sourcePreview: region.previewUrl });
        setOcrProgress((index + 1) / finalRegions.length);
      }
      acceptImportedDrafts(found);
    } catch (error) {
      console.error(error); setImportError('Bildelesingen kunne ikke fullføres. Sjekk nettilgangen til språkmodellen, eller bruk tekstimport.');
    } finally { if (worker) await worker.terminate(); setOcrBusy(false); }
  }

  function updateDraft(id: string, field: keyof ImportDraft, value: string) {
    setDrafts((all) => all.map((item) => item.id === id ? { ...item, [field]: value, ...(field === 'market' ? { category: inferCategory(value) } : {}) } : item));
  }

  function commitImport() {
    const invalid = drafts.filter((item) => draftErrors(item).length > 0);
    if (invalid.length) return setImportError(`${invalid.length} ${invalid.length === 1 ? 'kupong har' : 'kuponger har'} feil som må rettes før lagring.`);
    const seenSelections = new Set<string>();
    const valid = drafts.filter((item) => {
      if (!item.coupon) return true;
      const identity = [clean(item.coupon), clean(item.match), clean(item.market), clean(item.selection)].join('|').toLowerCase();
      if (seenSelections.has(identity)) return false;
      seenSelections.add(identity);
      return true;
    });
    if (!valid.length) return setImportError('Ingen kuponger er klare for lagring.');
    const knownCoupons = new Set(bets.map((bet) => bet.coupon).filter(Boolean));
    const fresh = valid.filter((item) => !item.coupon || !knownCoupons.has(item.coupon));
    setBets((all) => [...all, ...fresh.map((item) => {
      const odds = oddsFrom(item.odds); const stake = numberFrom(item.stake);
      return { id: crypto.randomUUID(), couponGroupId: item.groupId, match: clean(item.match), kickoff: clean(item.kickoff) || 'Tidspunkt ikke oppgitt', competition: clean(item.competition) || 'Fotball-VM 2026', coupon: clean(item.coupon), category: item.category, market: clean(item.market), selection: clean(item.selection), odds, stake, payout: numberFrom(item.payout) || stake * odds };
    })]);
    setImportedCount(new Set(fresh.map((item) => item.coupon || item.groupId)).size); setImportStep('success'); setImportError(fresh.length ? '' : 'Kupongene finnes allerede i oversikten.');
  }

  return (
    <div className="odds-page" data-theme={theme}>
      <div className="odds-atmosphere" aria-hidden="true" />
      <main className="tracker-shell">
        <nav className="tracker-nav" aria-label="Oddsen-Tracker">
          <a className="tracker-brand" href="#top" aria-label="Oddsen-Tracker, til toppen"><span className="brand-orbit"><Trophy size={17} /></span><span><strong>Oddsen-Tracker</strong><small>Din personlige kupongoversikt</small></span></a>
          <div className="nav-actions">
            {bets.length > 0 && <button className="nav-import" type="button" onClick={() => openImport('image')}><Upload size={15} /><span>Importer kupong</span></button>}
            <button className="theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Bytt til ${theme === 'dark' ? 'lyst' : 'mørkt'} tema`}><Sun className="sun-icon" size={17} /><Moon className="moon-icon" size={17} /></button>
          </div>
        </nav>

        <section id="top" className="world-cup-hero" style={{ '--hero-image': `url(${heroImage})` } as CSSProperties} aria-labelledby="hero-title">
          <div className="hero-copy"><span className="hero-kicker">Nord-Amerika 2026 · Turneringsoversikt</span><h1 id="hero-title">Fotball-VM <em>2026</em></h1><p>De største kampene og alle VM-kupongene dine, samlet i én kompromissløs premiumoversikt.</p><div className="market-pills"><span>Kampvinner</span><span>Målscorer</span><span>Toppscorer-odds</span><span>Turneringsvinner</span></div></div>
          <div className="hero-badge" aria-hidden="true"><b>26</b><span>World Cup</span></div>
          <dl className="hero-stats"><div><dt>VM-kuponger</dt><dd>{totals.coupons}</dd></div><div><dt>VM-innsats</dt><dd>{money.format(totals.stake)} kr</dd></div><div><dt>Høyeste odds</dt><dd>{totals.highest ? totals.highest.toFixed(2) : '—'}</dd></div></dl>
        </section>

        <section className="overview-card" aria-labelledby="overview-title">
          <div className="overview-copy"><span className="section-kicker">Oddsenoversikt</span><h2 id="overview-title">Mine <em>spill</em></h2><p>{bets.length ? 'Alle kuponger og spillvalg samlet på ett sted. Bruk importsnarveien øverst når du vil legge til flere.' : 'Arbeidsområdet er tomt. Start med skjermbilder, kupongtekst eller manuell registrering i importfeltet under.'}</p></div>
          <dl className="overview-stats"><div><dt>Aktive kuponger</dt><dd>{totals.coupons}</dd></div><div><dt>Total innsats</dt><dd>{money.format(totals.stake)} kr</dd></div><div><dt>Største enkeltpremie</dt><dd>{money.format(bets.reduce((max, bet) => Math.max(max, bet.payout), 0))} kr</dd></div><div><dt>Snittodds</dt><dd>{totals.averageOdds ? totals.averageOdds.toFixed(2) : '—'}</dd></div></dl>
        </section>

        {bets.length > 0 ? <>
          <section className="selection-bar" aria-live="polite"><div className="selection-copy"><span>Kupongbygger</span><strong>{chosen.length ? `${chosen.length} markert` : 'Marker spill'}</strong><small>Klikk direkte på en rad for å velge den.</small></div><div><span>Innsats</span><strong>{money.format(selectedStake)} kr</strong></div><div className="positive"><span>Mulig premie</span><strong>{money.format(selectedPayout)} kr</strong></div><div className="positive"><span>Mulig netto</span><strong>+{money.format(Math.max(0, selectedPayout - selectedStake))} kr</strong></div><button type="button" onClick={() => setSelected(new Set())} disabled={!chosen.length}>Nullstill</button></section>
          {matchGroups.map((group) => {
            const filter = filters[group.match] || 'Alle'; const visible = filter === 'Alle' ? group.bets : group.bets.filter((bet) => bet.category === filter);
            const groupTotals = trackedSummary(group.bets);
            const codes = teamCodes(group.match); const lead = group.bets[0];
            return <section className="match-card" key={group.match} aria-label={group.match}>
              <header className="match-header"><div><span className="section-kicker">{lead.competition || 'Fotball-VM 2026'} / Kamp</span><time className="match-kickoff">{lead.kickoff}</time><h2>{codes.special ? <strong className="event-title">{group.match}</strong> : <><b>{codes.home}</b><i>VS</i><b>{codes.away}</b></>}</h2></div><div className="match-header-side"><dl><div><dt>Kuponger</dt><dd>{groupTotals.coupons}</dd></div><div><dt>Satset</dt><dd>{money.format(groupTotals.stake)} kr</dd></div><div><dt>Toppodds</dt><dd>{groupTotals.highest.toFixed(2)}</dd></div></dl><button className="delete-match-button" type="button" onClick={() => { if (window.confirm(`Slett hele spillet «${group.match}»? Dette fjerner ${groupTotals.coupons} ${groupTotals.coupons === 1 ? 'kupong' : 'kuponger'} og ${group.bets.length} ${group.bets.length === 1 ? 'spillvalg' : 'spillvalg'}.`)) removeMatch(group.match); }}><Trash2 size={15} /> Slett hele spillet</button></div></header>
              <div className="filter-bar" aria-label={`Filtrer spill for ${group.match}`}>{CATEGORIES.map((category) => { const count = category === 'Alle' ? group.bets.length : group.bets.filter((bet) => bet.category === category).length; if (category !== 'Alle' && !count) return null; return <button key={category} type="button" className={filter === category ? 'active' : ''} aria-pressed={filter === category} onClick={() => setFilters((all) => ({ ...all, [group.match]: category }))}>{category}<span>{count}</span></button>; })}<p><GripVertical size={14} /> Dra for å endre rekkefølge</p></div>
              <div className="bet-columns" aria-hidden="true"><span /><span>Type og spill</span><span>Odds</span><span>Innsats</span><span>Mulig premie</span><span /></div>
              <div className="bet-list" role="listbox" aria-label={`Spill for ${group.match}`} aria-multiselectable="true">{visible.map((bet, index) => {
                const isSelected = selected.has(bet.id); const dropClass = dropTarget?.id === bet.id ? `drop-${dropTarget.edge}` : '';
                const key = couponKey(bet); const couponBetCount = bets.filter((item) => couponKey(item) === key).length;
                return <article key={bet.id} className={`bet-row category-${categoryClass[bet.category]} ${isSelected ? 'selected' : ''} ${draggedId === bet.id ? 'dragging' : ''} ${settlingId === bet.id ? 'settling' : ''} ${dropClass}`} draggable onDragStart={(event) => beginDrag(event, bet.id)} onDragOver={(event) => markDrop(event, bet.id)} onDrop={finishDrop} onDragEnd={endDrag} onClick={() => toggleBet(bet.id)} onKeyDown={(event) => handleRowKeyDown(event, bet.id)} role="option" tabIndex={0} aria-selected={isSelected} aria-label={`${bet.market}: ${bet.selection}`}><span className="drag-control" aria-hidden="true"><GripVertical size={17} /><b>{String(index + 1).padStart(2, '0')}</b></span><div className="bet-main"><span><i>{categoryCode[bet.category]}</i>{bet.market}{bet.coupon && <small className="coupon-reference">Kupong {bet.coupon}</small>}</span><strong>{bet.selection}</strong></div><div className="bet-number odds"><span>Odds</span><strong>{bet.odds.toFixed(2)}</strong></div><div className="bet-number"><span>Innsats</span><strong>{money.format(bet.stake)} kr</strong></div><div className="bet-number payout"><span>Mulig premie</span><strong>{money.format(bet.payout)} kr</strong><small>+{money.format(bet.payout - bet.stake)} kr netto</small></div><button className="delete-bet" type="button" onClick={(event) => { event.stopPropagation(); if (window.confirm(`Slett kupong${bet.coupon ? ` ${bet.coupon}` : ''}? Dette fjerner ${couponBetCount} ${couponBetCount === 1 ? 'spillvalg' : 'spillvalg'}.`)) removeCoupon(key); }} aria-label={`Slett hele kupong${bet.coupon ? ` ${bet.coupon}` : ''}`} title="Slett hele kupongen"><Trash2 size={18} /><span className="sr-only">Slett hele kupongen</span></button></article>;
              })}</div>
              <footer className="match-footer"><span>{visible.length} av {group.bets.length} spillvalg · {groupTotals.coupons} {groupTotals.coupons === 1 ? 'kupong' : 'kuponger'}</span><strong>Total mulig utbetaling {money.format(groupTotals.payout)} kr</strong></footer>
            </section>;
          })}
          <section className="workspace-danger-zone" aria-label="Administrer kuponger"><div><strong>Administrer arbeidsområdet</strong><span>Fjern alle lagrede kuponger fra denne nettleseren.</span></div><button className="delete-all-button" type="button" onClick={() => { if (window.confirm(`Slett alle ${totals.coupons} kuponger? Dette kan ikke angres.`)) removeAllCoupons(); }}><Trash2 size={17} /> Slett alle kuponger</button></section>
        </> : <section className="empty-dashboard" aria-labelledby="empty-dashboard-title"><button className="empty-visual" type="button" onClick={() => openImport('image')} aria-label="Åpne import av kupong" title="Importer kupong"><Upload size={28} /></button><span className="section-kicker">Arbeidsområdet er klart</span><h2 id="empty-dashboard-title">Importer din første kupong</h2><p>Klikk på ikonet for å starte med skjermbilder. Kupongtekst og manuell registrering velges i samme importdialog.</p><div className="empty-methods" aria-label="Tilgjengelige importmetoder"><span><ImageIcon size={13} /> Skjermbilder</span><span><FileText size={13} /> Kupongtekst</span><span><Plus size={13} /> Manuelt</span></div></section>}
      </main>

      {importOpen && <div className="modal-backdrop" role="presentation">
        <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <header className="import-header"><div><span className="section-kicker">{importStep === 'review' ? 'Kontroller før lagring' : importStep === 'success' ? 'Import fullført' : appendImport ? 'Utvid innlesningen' : 'Ny kupongimport'}</span><h2 id="import-title">{importStep === 'review' ? `${draftCouponCount} ${draftCouponCount === 1 ? 'kupong' : 'kuponger'} · ${drafts.length} spillvalg` : importStep === 'success' ? 'Kupongene er lagt til' : appendImport ? 'Importer flere kuponger' : 'Importer kupong'}</h2></div><button type="button" onClick={closeImport} aria-label="Lukk"><X /></button></header>
          {importStep === 'source' && <div className="import-body">
            <div className="import-tabs" role="tablist" aria-label="Velg importmetode"><button type="button" role="tab" aria-selected={importMode === 'image'} className={importMode === 'image' ? 'active' : ''} onClick={() => { setImportMode('image'); setImportError(''); }}><ImageIcon size={16} /> Skjermbilder</button><button type="button" role="tab" aria-selected={importMode === 'text'} className={importMode === 'text' ? 'active' : ''} onClick={() => { setImportMode('text'); setImportError(''); }}><FileText size={16} /> Kupongtekst</button></div>
            {importMode === 'image' ? <><input id="coupon-images" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files && addFiles(event.target.files)} /><label className="dropzone" htmlFor="coupon-images" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}><Upload size={30} /><strong>Slipp skjermbilder her</strong><span>eller klikk for å velge PNG, JPG eller WEBP · maks 8 bilder</span></label>{uploadFiles.length > 0 && <div className="image-queue">{uploadFiles.map((item) => <figure key={item.url}><img src={item.url} alt={item.file.name} /><figcaption>{item.file.name}</figcaption><button type="button" onClick={() => { URL.revokeObjectURL(item.url); setUploadFiles((all) => all.filter((file) => file.url !== item.url)); }} aria-label={`Fjern ${item.file.name}`}><X size={14} /></button></figure>)}</div>}{ocrBusy && <div className="ocr-progress"><div><Loader2 className="spin" size={17} /><span>{detectedRegions ? `${detectedRegions} kupongområder funnet` : 'Deler bildet i kuponger'} · {Math.round(ocrProgress * 100)} %</span></div><i style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div>}</> : <label className="text-source">Kupongtekst<textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'Lim inn én eller flere kvitteringer her…\n\nInnsats: 100,00\nOdds: 2.10\nMulig Premie: 210,00\n1. Norge v England\nStarttid: 11/7 23:00\nSpillobjekt: Scorer mål\nSpilt utfall: Erling Haaland'} /></label>}
            {importError && <p className="import-error">{importError}</p>}
          </div>}
          {importStep === 'review' && <div className="import-body review-body">
            <div className="review-intro"><Check size={18} /><p><strong>{draftCouponCount} {draftCouponCount === 1 ? 'kupong' : 'kuponger'} med {drafts.length} spillvalg til kontroll.</strong> Røde kort må rettes før noe kan lagres.</p></div>
            <div className="review-list">{drafts.map((item, index) => {
              const errors = draftErrors(item);
              return <article className={`review-card ${errors.length ? 'is-invalid' : 'is-valid'}`} key={item.id}>
                <div className="review-card-head"><strong>Spillvalg {index + 1}</strong><span>{item.sourceName || 'Manuelt registrert'}</span><em>{errors.length ? `${errors.length} feil` : 'Klar'}</em><button type="button" onClick={() => setDrafts((all) => all.filter((row) => row.id !== item.id))} aria-label={`Fjern spillvalg ${index + 1}`}><Trash2 size={15} /></button></div>
                {item.sourcePreview && <img className="review-preview" src={item.sourcePreview} alt={`Bildeutdrag for spillvalg ${index + 1}`} />}
                <div className="review-grid"><label className="wide">Kamp<input value={item.match} onChange={(event) => updateDraft(item.id, 'match', event.target.value)} placeholder="Norge v England" /></label><label>Starttid<input value={item.kickoff} onChange={(event) => updateDraft(item.id, 'kickoff', event.target.value)} /></label><label>Turnering<input value={item.competition} onChange={(event) => updateDraft(item.id, 'competition', event.target.value)} /></label><label className="wide">Marked<input value={item.market} onChange={(event) => updateDraft(item.id, 'market', event.target.value)} /></label><label className="wide">Spillvalg<input value={item.selection} onChange={(event) => updateDraft(item.id, 'selection', event.target.value)} /></label><label>Odds<input inputMode="decimal" value={item.odds} onChange={(event) => updateDraft(item.id, 'odds', event.target.value)} /></label><label>Innsats<input inputMode="decimal" value={item.stake} onChange={(event) => updateDraft(item.id, 'stake', event.target.value)} /></label><label>Mulig premie<input inputMode="decimal" value={item.payout} onChange={(event) => updateDraft(item.id, 'payout', event.target.value)} /></label><label>Kategori<select value={item.category} onChange={(event) => updateDraft(item.id, 'category', event.target.value)}>{CATEGORIES.slice(1).map((category) => <option key={category}>{category}</option>)}</select></label><label className="wide">Kupongnummer<input value={item.coupon} onChange={(event) => updateDraft(item.id, 'coupon', event.target.value)} /></label></div>
                {errors.length > 0 && <ul className="review-errors">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
              </article>;
            })}</div>
            {importError && <p className="import-error">{importError}</p>}
          </div>}
          {importStep === 'success' && <div className="import-success"><span><Check /></span><h3>{importedCount} {importedCount === 1 ? 'kupong importert' : 'kuponger importert'}</h3><p>Spillene er lagret lokalt og vises nå i kampoversikten.</p></div>}
          <footer className="import-footer">
            <div>
              {importStep === 'review' && <><button type="button" className="secondary-button" onClick={returnToImportSource}><ChevronLeft size={16} /> Tilbake</button><button type="button" className="secondary-button import-more-button" onClick={beginAdditionalImport}><Upload size={16} /> Importer flere</button></>}
              {importStep === 'source' && <button type="button" className="secondary-button" onClick={() => acceptImportedDrafts([draft()])}>Registrer manuelt</button>}
              {importStep === 'success' && <button type="button" className="secondary-button import-more-button" onClick={beginAdditionalImport}><Upload size={16} /> Importer flere kuponger</button>}
            </div>
            <div>
              {importStep === 'source' && <button type="button" className="primary-button" disabled={ocrBusy} onClick={processSource}>{ocrBusy ? <Loader2 className="spin" size={17} /> : importMode === 'image' ? <ImageIcon size={17} /> : <FileText size={17} />}{ocrBusy ? 'Leser bilder' : importMode === 'image' ? 'Les skjermbilder' : 'Finn kuponger'}</button>}
              {importStep === 'review' && <><button type="button" className="secondary-button" onClick={() => setDrafts((all) => [...all, draft()])}><Plus size={16} /> Legg til rad</button><button type="button" className="primary-button" onClick={commitImport}><Check size={17} /> Lagre kuponger</button></>}
              {importStep === 'success' && <button type="button" className="primary-button" onClick={closeImport}>Ferdig</button>}
            </div>
          </footer>
        </section>
      </div>}
    </div>
  );
}
