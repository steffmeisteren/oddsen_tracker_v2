import {
  useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type DragEvent, type KeyboardEvent,
} from 'react';
import {
  Check, ChevronLeft, FileText, GripVertical, Image as ImageIcon, Loader2, Moon, Plus,
  Sun, Trash2, Trophy, Upload, X,
} from 'lucide-react';
import { createWorker } from 'tesseract.js';
import heroImage from '../../assets/world-cup-stadium-hero.png';
import { resolveWorldCupTeam } from './worldCupTeams';
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

interface EconomicValues { odds: number; stake: number; payout: number; }

function economicRelativeError(values: EconomicValues) {
  if (!(values.odds > 1 && values.stake > 0 && values.payout > 0)) return Number.POSITIVE_INFINITY;
  return Math.abs((values.odds * values.stake) - values.payout) / Math.max(1, values.payout);
}

function economicScaleCandidates(value: number, kind: 'odds' | 'money') {
  if (!(value > 0)) return [];
  const factors = kind === 'odds' ? [1, .1, .01, 10] : [1, .1, .01];
  return factors.map((factor) => ({
    value: value * factor,
    penalty: factor === 1 ? 0 : factor === .1 ? .012 : factor === .01 ? .024 : .03,
  })).filter((candidate, index, all) => {
    const valid = kind === 'odds' ? candidate.value > 1 && candidate.value < 1000 : candidate.value > 0 && candidate.value < 1_000_000;
    return valid && all.findIndex((item) => Math.abs(item.value - candidate.value) < .0001) === index;
  });
}

/**
 * Repairs common OCR separator loss without changing already coherent values.
 * Examples: 63750 -> 637.50, 2500 -> 250, 25.5 -> 2.55 when the other
 * two values prove the decimal placement through stake × odds = payout.
 */
function reconcileEconomicValues(values: EconomicValues): EconomicValues {
  const currentError = economicRelativeError(values);
  if (!Number.isFinite(currentError) || currentError <= .06) return values;

  let best: { values: EconomicValues; error: number; score: number } | null = null;
  for (const odds of economicScaleCandidates(values.odds, 'odds')) {
    for (const stake of economicScaleCandidates(values.stake, 'money')) {
      for (const payout of economicScaleCandidates(values.payout, 'money')) {
        const candidate = { odds: odds.value, stake: stake.value, payout: payout.value };
        const error = economicRelativeError(candidate);
        const score = error + odds.penalty + stake.penalty + payout.penalty;
        if (!best || score < best.score) best = { values: candidate, error, score };
      }
    }
  }

  if (!best || best.error > .06 || best.score >= currentError) return values;
  return best.values;
}

function compactDraftNumber(value: number) {
  return Number.isFinite(value) && value > 0 ? String(Number(value.toFixed(2))) : '';
}

function reconcileDraftEconomics(item: ImportDraft): ImportDraft {
  const original = { odds: oddsFrom(item.odds), stake: numberFrom(item.stake), payout: numberFrom(item.payout) };
  const corrected = reconcileEconomicValues(original);
  return {
    ...item,
    odds: compactDraftNumber(corrected.odds) || item.odds,
    stake: compactDraftNumber(corrected.stake) || item.stake,
    payout: compactDraftNumber(corrected.payout) || item.payout,
  };
}

function inferCategory(market = ''): Category {
  const value = market.toLowerCase();
  if (/halvtid\s*[\/-]\s*fulltid|korrekt resultat|kampvinner|resultat|\b1x2\b/.test(value)) return 'Resultat';
  if (/vinner.*(?:vm|turnering)|golden boot|toppscorer|mester|turneringsvinner|spesial/.test(value)) return 'Spesial';
  if (/begge lag|totalt antall|over\s*\/?\s*under|\bhub\b/.test(value)) return 'Kamp';
  if (/scorer|spiller|assist|heading|hat.?trick/.test(value)) return 'Spiller';
  if (/tidspunkt|minutt|første mål/.test(value)) return 'Timing';
  if (/kort|corner|hjørne|takling|skudd|statistikk/.test(value)) return 'Statistikk';
  if (/omgang/.test(value)) return 'Resultat';
  return 'Kamp';
}

function draft(): ImportDraft {
  return { id: crypto.randomUUID(), groupId: crypto.randomUUID(), match: '', kickoff: '', competition: '', coupon: '', category: 'Kamp', market: '', selection: '', odds: '', stake: '', payout: '' };
}

function normalizeOcrText(rawText: string) {
  return String(rawText || '')
    .replace(/\r/g, '')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\b[iIl|]nns[a4]t[s5]\b/gi, 'Innsats')
    .replace(/\b(?:[o0]dds|[o0]{2}dds)\b/gi, 'Odds')
    .replace(/mulig\s*pr(?:e|3|er|rn)[mn]?[i1l][e3]/gi, 'Mulig Premie')
    .replace(/startt[i1l]d/gi, 'Starttid')
    .replace(/kamp\s*start/gi, 'Kampstart')
    .replace(/k[o0]nk[uuvy]rr[a-zæøå0-9|!]*s[e3]/gi, 'Konkurranse')
    .replace(/sp[i1l|!]{1,3}\s*[o0]b[jyi1l|!]*[e3]k[t7l|!]/gi, 'Spillobjekt')
    .replace(/sp[i1l|!]{1,3}[t7l|!]?\s*u[t7l|!][fph][a-zæøå0-9|!]*/gi, 'Spilt utfall')
    .replace(/sp[i1l|!]{1,3}\s*v[a4]lg/gi, 'Spillvalg')
    .replace(/kupong\s*(?:nummer|numm?er|nr\.?)/gi, 'Kupongnummer')
    .replace(/\s+(?=(?:Innsats|Odds|Mulig Premie|Starttid|Kampstart|Konkurranse|Spillobjekt|Spilt utfall|Levert|Kupongnummer)\s*:)/gi, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

const OCR_FIELD_NAMES = 'Innsats|Odds|Mulig Premie|Starttid|Kampstart|Konkurranse|Spillobjekt|Marked|Spilt utfall|Utfall|Spillvalg|Levert|Kupongnummer';
const OUTCOME_LABEL = /^(?:Spilt\s*utfall|Spill\s*utfall|Utfall|Spillvalg)\b/i;
const RECEIPT_FIELD_LABEL = /^(?:Innsats|Odds|Mulig Premie|Starttid|Kampstart|Konkurranse|Spillobjekt|Marked|Spilt\s*utfall|Spill\s*utfall|Utfall|Spillvalg|Levert|Kupongnummer)\b/i;
const RECEIPT_METADATA_WORDS = /\b(?:Singel|System|Aktiv|Levert)\b/i;

function fieldAfter(text: string, label: string) {
  const match = text.match(new RegExp(`(?:^|\\n|\\s)(?:${label})\\b\\s*:?\\s*([\\s\\S]*?)(?=(?:\\n|\\s)+(?:${OCR_FIELD_NAMES})\\b\\s*:?|$)`, 'i'));
  return clean(match?.[1] || '');
}

function invalidSelectionCandidate(value: string) {
  const normalized = clean(value);
  if (!normalized || RECEIPT_METADATA_WORDS.test(normalized)) return true;
  if (/^(?:Oddsen|Singel|System|Aktiv|Levert)(?:\s|$)/i.test(normalized)) return true;
  return /\b(?:Spillobjekt|Spilt?\s*utfall|Spillvalg|Kupongnummer|Konkurranse|Mulig\s+Premie|Innsats)\b/i.test(normalized);
}

/**
 * Reads only the value belonging to the explicit outcome label. Receipt status
 * text above the event must never be used as a fallback selection.
 */
function outcomeSelectionFromText(text: string) {
  const lines = normalizeOcrText(text).split('\n').map(clean).filter(Boolean);
  const labelIndex = lines.findIndex((line) => OUTCOME_LABEL.test(line));
  if (labelIndex < 0) return { foundLabel: false, value: '' };

  const values: string[] = [];
  const inline = clean(lines[labelIndex].replace(OUTCOME_LABEL, '').replace(/^\s*:?\s*/, ''));
  if (inline && !invalidSelectionCandidate(inline)) values.push(inline);

  for (let index = labelIndex + 1; index < lines.length && values.length < 5; index += 1) {
    const line = clean(lines[index]);
    if (!line) continue;
    if (RECEIPT_FIELD_LABEL.test(line) || /^\d{1,2}[.)]\s+/.test(line) || invalidSelectionCandidate(line)) break;
    if (/^\d{1,3}(?:(?:[.,]|\s)\d{2})$/.test(line)) break;
    values.push(line);
  }

  const value = clean(values.join(' '));
  return { foundLabel: true, value: invalidSelectionCandidate(value) ? '' : value };
}

function stripTrailingReceiptOdds(value: string, receiptOdds: number, force = false) {
  const normalized = clean(value);
  const match = normalized.match(/^(.*\S)\s+(\d{1,3}(?:(?:[.,]|\s)\d{2}))\s*$/);
  if (!match) return normalized;
  if (/\b(?:over|under)\s*$/i.test(match[1])) return normalized;
  const trailing = oddsFrom(match[2]);
  return trailing > 1 && (force || (receiptOdds > 1 && Math.abs(trailing - receiptOdds) <= .02))
    ? clean(match[1])
    : normalized;
}

function labeledNumber(text: string, label: string, isOdds = false) {
  const pattern = isOdds
    ? '([0-9]{1,3}(?:(?:[.,]|\\s)[0-9]{1,2})?)'
    : '([0-9]+(?:[ .][0-9]{3})*(?:,[0-9]{1,2})?)';
  const value = text.match(new RegExp(`(?:${label})\\s*:?\\s*(?:kr\\s*)?${pattern}`, 'i'))?.[1] || '';
  return isOdds ? oddsFrom(value) : numberFrom(value);
}

function invalidMatchCandidate(value: string) {
  const normalized = clean(value);
  if (!normalized) return true;
  if (/^(?:oddsen|singel|aktiv|mine spill|importert kupong|tidspunkt ikke oppgitt)/i.test(normalized)) return true;
  if (/\b(?:rekke|innsats|odds|mulig premie|kupongnummer|levert)\b/i.test(normalized)) return true;
  return normalized.length < 3 || normalized.length > 110;
}

function comparableMatchText(value: string) {
  return clean(value)
    .replace(/^&\s*/, '')
    .toLocaleLowerCase('nb-NO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function competitionOnlyMatch(value: string, competition = '') {
  const candidate = comparableMatchText(value);
  if (!candidate || /\s(?:v|vs|mot)\s/i.test(candidate)) return false;
  const competitionKey = comparableMatchText(competition);
  if (competitionKey && (candidate === competitionKey || candidate.includes(competitionKey) || competitionKey.includes(candidate))) return true;
  return /^(?:internasjonal|international)(?:\s|$)|\b(?:fotball\s*vm|world cup|vm 20\d{2}|champions league|europa league|premier league|spesialer)\b/i.test(candidate);
}

function headToHeadMatch(value: string) {
  const candidate = clean(value);
  return /\s(?:v|vs\.?|mot)\s/i.test(candidate) || /^[A-Za-zÆØÅæøåÉé.' ]+\s[-–—]\s[A-Za-zÆØÅæøåÉé.' ]+$/.test(candidate);
}

function eventMatchFallback(match: string, market: string, competition: string) {
  const candidate = clean(match);
  if (invalidMatchCandidate(candidate)) return '';
  if (inferCategory(market) !== 'Spesial' && competitionOnlyMatch(candidate, competition)) return '';
  return candidate.replace(/^&\s*/, '');
}

type ReceiptHints = { match: string; market: string; selection: string; kickoff: string; competition: string };

function receiptLineKey(value: string) {
  return clean(value).toLocaleLowerCase('nb-NO').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9&.+/-]+/g, ' ').trim();
}

function receiptNoiseLine(value: string) {
  const line = receiptLineKey(value);
  return !line || /^(?:oddsen(?:\s+(?:singel|system|aktiv|levert))*|singel|system|aktiv|levert|vis detaljer|skjul detaljer)$/.test(line) ||
    /\b(?:rekke|innsats|odds|mulig premie|kupongnummer|levert)\b/.test(line) ||
    /^\d+(?:[.,]\d+)?(?: kr)?$/.test(line);
}

function semanticMarketLine(value: string) {
  const line = receiptLineKey(value);
  return /(?:vinner|toppscorer|golden boot|kampvinner|begge lag|\bhub\b|scorer|spiller|assist|malscorer|antall mal|totalt antall|over\s*\/?\s*under|halvtid|fulltid|kort|corner|hjorne|resultat|omgang|tidspunkt|minutt|turnering)/.test(line);
}

function semanticSelectionLine(value: string) {
  const line = clean(value);
  const key = receiptLineKey(line);
  if (!line || invalidSelectionCandidate(line) || receiptNoiseLine(line)) return false;
  if (/^(?:ja|nei|over\s+\d|under\s+\d|.+\s+og\s+(?:over|under)\s+\d|uavgjort\s*-\s*.+|[12xhub]|[a-zæøå .'-]+\s*&\s*[a-zæøå .'-]+)$/i.test(line)) return true;
  if (semanticMarketLine(line)) return false;
  if (/\b(?:norge|england|spania|belgia|frankrike|marokko|haaland|mbapp[eé]|kane)\b/i.test(line) && !/\s(?:v|vs\.?|mot)\s/i.test(line)) return true;
  if (/^[A-ZÆØÅ][A-Za-zÆØÅæøåÉé.'-]+(?:\s+[A-ZÆØÅ][A-Za-zÆØÅæøåÉé.'-]+){0,4}$/.test(line)) return true;
  return key.length >= 2 && key.length <= 90 && /[a-zæøå]/i.test(line) && /(?:^|\s)(?:ja|nei)$/.test(key);
}

function collectFollowingLines(lines: string[], start: number, stop: (line: string) => boolean, maximum = 5) {
  const values: string[] = [];
  for (let index = start; index < lines.length && values.length < maximum; index += 1) {
    const line = clean(lines[index]);
    if (!line) continue;
    if (stop(line)) break;
    values.push(line);
  }
  return clean(values.join(' '));
}

function inferReceiptHints(text: string): ReceiptHints {
  const normalized = normalizeOcrText(text);
  const lines = normalized.split('\n').map(clean).filter(Boolean);
  const labelPattern = /^(?:Innsats|Odds|Mulig Premie|Starttid|Kampstart|Konkurranse|Spillobjekt|Marked|Spilt utfall|Utfall|Spillvalg|Levert|Kupongnummer)\b/i;
  const valueAfter = (label: RegExp) => {
    const index = lines.findIndex((line) => label.test(line));
    if (index < 0) return '';
    const inline = clean(lines[index].replace(label, '').replace(/^\s*:?\s*/, ''));
    if (inline) return inline;
    return collectFollowingLines(lines, index + 1, (line) => labelPattern.test(line), 5);
  };

  let market = valueAfter(/^(?:Spillobjekt|Marked)\b/i);
  const outcome = outcomeSelectionFromText(normalized);
  let selection = stripTrailingReceiptOdds(outcome.value, labeledNumber(normalized, 'Odds', true));
  let competition = valueAfter(/^Konkurranse\b/i);

  if (!market) {
    const marketIndex = lines.findIndex((line) => semanticMarketLine(line) && !receiptNoiseLine(line));
    if (marketIndex >= 0) market = collectFollowingLines(lines, marketIndex, (line) => labelPattern.test(line) || semanticSelectionLine(line), 5);
  }
  if (!selection && !outcome.foundLabel) {
    const marketIndex = market ? lines.findIndex((line) => market.includes(clean(line)) || clean(line).includes(clean(market))) : -1;
    const candidates = lines.slice(Math.max(0, marketIndex + 1));
    selection = clean(candidates.find((line) => semanticSelectionLine(line)) || '');
  }
  if (!competition) {
    competition = clean(lines.find((line) => competitionOnlyMatch(line)) || '').replace(/^&\s*/, '');
  }

  const numbered = lines.map((line) => clean(line.replace(/^\s*\d{1,2}[.)]\s*/, '')))
    .find((line) => !invalidMatchCandidate(line) && (/(?:fotball.?vm|vm\s*2026|world cup)/i.test(line) || /\s(?:v|vs\.?|mot)\s/i.test(line)));
  const versus = lines.find((line) => !invalidMatchCandidate(line) && /\s(?:v|vs\.?|mot)\s/i.test(line));
  const event = lines.find((line) => !invalidMatchCandidate(line) && /^(?:fotball.?vm|vm\s*2026|fifa world cup)/i.test(line));
  const marketIndex = lines.findIndex((line) => semanticMarketLine(line) && !receiptNoiseLine(line));
  const teamLines = lines.slice(0, marketIndex >= 0 ? marketIndex : lines.length)
    .map((line) => removeKickoffCandidate(clean(line.replace(/^\s*\d{1,2}[.)]\s*/, ''))))
    .filter((line) => likelyTeamLine(line) && !receiptNoiseLine(line) && !labelPattern.test(line));
  const pairedTeams = teamLines.length >= 2 ? `${teamLines.at(-2)} vs ${teamLines.at(-1)}` : '';
  const match = [versus, numbered, pairedTeams, event]
    .map((candidate) => eventMatchFallback(candidate || '', market, competition))
    .find(Boolean) || '';

  const labeledKickoff = valueAfter(/^(?:Starttid|Kampstart)\b/i);
  const rawKickoff = /(?:\d{1,2}[/.:-]\d{1,2}|\bI\s*(?:dag|morgen)\b)/i.test(labeledKickoff)
    ? labeledKickoff
    : clean(lines.find((line) => /\b(?:I\s*dag|Idag|I\s*morgen)\s*\d{1,2}[:.]\d{2}\b|\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\s+\d{1,2}[:.]\d{2}\b/i.test(line)) || '');
  const purchase = clean(lines.find((line) => Boolean(parseCouponDateParts(line)?.year) && line !== rawKickoff) || '');
  const kickoff = /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}$/.test(clean(rawKickoff))
    ? clean(rawKickoff)
    : (resolvePositionedKickoff(rawKickoff, purchase) || clean(rawKickoff));

  return {
    match: clean(match),
    market: clean(market),
    selection: clean(selection),
    kickoff: clean(kickoff),
    competition: clean(competition),
  };
}

function looseDraftFromText(text: string, sourceName?: string, sourcePreview?: string): ImportDraft | null {
  const normalized = normalizeOcrText(text);
  const lines = normalized.split('\n').map(clean).filter(Boolean);
  const hints = inferReceiptHints(normalized);
  const numberedMatch = clean(normalized.match(/(?:^|\n)\s*\d{1,2}[.)]\s+(?=[^\n]*[A-Za-zÆØÅæøå])([^\n]{2,100})/m)?.[1] || '');
  const inlineMatch = clean(normalized.match(/([A-ZÆØÅ][^:\n]{1,80}?\s(?:v|vs\.?|mot)\s[^:\n]{1,80}?)(?=\s+Starttid\b)/i)?.[1] || '');
  const versusLine = lines.find((line) => line.length <= 110 && /\s(?:v|vs\.?|mot)\s/i.test(line) && !/(?:odds|innsats|premie|kupong)/i.test(line));
  const market = fieldAfter(normalized, 'Spillobjekt|Marked') || hints.market;
  const odds = labeledNumber(normalized, 'Odds', true);
  const outcome = outcomeSelectionFromText(normalized);
  const selection = stripTrailingReceiptOdds(outcome.value || (!outcome.foundLabel ? hints.selection : ''), odds);
  const kickoffRaw = fieldAfter(normalized, 'Starttid|Kampstart') || hints.kickoff ||
    normalized.match(/\b(?:I\s*dag|Idag|I\s*morgen)\s*\d{1,2}\s*[:.]\s*\d{2}\b/i)?.[0] || '';
  const purchaseText = lines.find((line) => /\bDato\b/i.test(line)) ||
    lines.find((line) => /(?:januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember).*\d{1,2}[:.]\d{2}/i.test(line)) || '';
  const kickoff = resolvePositionedKickoff(kickoffRaw, purchaseText) || normalizeAbsoluteKickoff(kickoffRaw);
  const competition = fieldAfter(normalized, 'Konkurranse') || hints.competition;
  const candidates = [fieldAfter(normalized, 'Kamp'), numberedMatch, inlineMatch, clean(versusLine || ''), hints.match];
  const explicitMatch = candidates.map((value) => eventMatchFallback(value, market, competition)).find(Boolean) || '';
  const couponRaw = normalized.match(/(?:Kupongnummer|\b(?:ID|1D|lD))\s*:?\s*([0-9][0-9., ]{5,})/i)?.[1] || '';
  const coupon = clean(couponRaw.replace(/\s/g, '').replace(/(?<=\d),(?=\d)/g, '.'));
  const stake = labeledNumber(normalized, 'Innsats');
  const payout = labeledNumber(normalized, 'Mulig Premie');
  if (!explicitMatch && !market && !selection && !stake && !odds && !payout && !coupon) return null;
  const item = draft();
  return reconcileDraftEconomics({
    ...item,
    sourceName,
    sourcePreview,
    groupId: coupon || item.groupId,
    match: eventMatchFallback(explicitMatch, market, competition),
    kickoff,
    competition,
    coupon,
    market,
    selection,
    category: inferCategory(market),
    odds: String(odds || ''),
    stake: String(stake || ''),
    payout: String(payout || (stake && odds ? stake * odds : '') || ''),
  });
}

function mergeDraftData(primary: ImportDraft, fallback: ImportDraft | null): ImportDraft {
  if (!fallback) return normalizeImportedDraft(primary);
  const emptyOr = (value: string, placeholder?: string) => !clean(value) || (placeholder ? clean(value) === placeholder : false);
  const market = emptyOr(primary.market, 'Spillmarked') ? fallback.market : primary.market;
  const competition = emptyOr(primary.competition, 'Fotball-VM 2026') && fallback.competition !== 'Fotball-VM 2026' ? fallback.competition : primary.competition;
  const primaryMatch = eventMatchFallback(primary.match, market, competition);
  const fallbackMatch = eventMatchFallback(fallback.match, market, competition);
  return normalizeImportedDraft({
    ...primary,
    groupId: primary.coupon || fallback.coupon || primary.groupId,
    match: emptyOr(primaryMatch, 'Importert kupong') ? fallbackMatch : primaryMatch,
    kickoff: emptyOr(primary.kickoff, 'Tidspunkt ikke oppgitt') ? fallback.kickoff : primary.kickoff,
    competition,
    coupon: primary.coupon || fallback.coupon,
    market,
    selection: invalidSelectionCandidate(primary.selection) ? fallback.selection : primary.selection,
    category: inferCategory(market),
    odds: primary.odds || fallback.odds,
    stake: primary.stake || fallback.stake,
    payout: primary.payout || fallback.payout,
  });
}

export function parseCouponText(rawText: string, sourceName?: string, sourcePreview?: string): ImportDraft[] {
  const text = normalizeOcrText(rawText)
    .replace(/\s+(?=\d{1,2}[.)]\s+[^:\n]{2,100}\s+(?:Starttid|Konkurranse|Spillobjekt)\s*:)/gi, '\n')
    .replace(/\s+(?=(?:Starttid|Kampstart|Konkurranse|Spillobjekt|Spilt utfall|Levert|Kupongnummer)\s*:)/gi, '\n');
  const summaryPattern = /innsats\s*:?\s*([0-9]+(?:[ .][0-9]{3})*(?:,[0-9]{1,2})?)[\s\S]{0,500}?\bOdds\s*:?\s*([0-9]+(?:(?:[.,]|\s)[0-9]{1,2})?)[\s\S]{0,500}?Mulig\s+Premie\s*:?\s*([0-9]+(?:[ .][0-9]{3})*(?:,[0-9]{1,2})?)/gi;
  const summaries = [...text.matchAll(summaryPattern)];

  if (summaries.length) return summaries.flatMap((summary, index): ImportDraft[] => {
    const blockStart = summaries.length === 1 ? 0 : summary.index;
    const block = text.slice(blockStart, summaries[index + 1]?.index ?? text.length);
    const loose = looseDraftFromText(block, sourceName, sourcePreview);
    const coupon = clean(block.match(/Kupongnummer\s*:?\s*([0-9. ]+)/i)?.[1]?.replace(/\s/g, '') || loose?.coupon || '');
    const groupId = coupon || crypto.randomUUID();
    const stake = String(numberFrom(summary[1]) || loose?.stake || '');
    const payout = String(numberFrom(summary[3]) || loose?.payout || '');
    const markers = [...block.matchAll(/(?:^|\n)\s*\d{1,2}[.)]\s+(?=[^\n]*[A-Za-zÆØÅæøå])([^\n]{2,100})/gm)];
    const parseSection = (section: string, fallbackMatch = ''): ImportDraft => {
      const sectionLoose = looseDraftFromText(section, sourceName, sourcePreview) || loose;
      const market = clean(section.match(/Spillobjekt\s*:?\s*([\s\S]*?)(?=\s*Spilt\s+utfall)/i)?.[1] || section.match(/Marked\s*:?\s*([^\n]+)/i)?.[1] || sectionLoose?.market || '');
      const odds = oddsFrom(summary[2]) || oddsFrom(sectionLoose?.odds);
      const outcome = outcomeSelectionFromText(section);
      const rawSelection = clean(outcome.value || (!outcome.foundLabel ? sectionLoose?.selection : '') || '');
      const selectionOdds = rawSelection.match(/\s+([0-9]+(?:(?:[.,]|\s)[0-9]{1,2})?)$/);
      let selection = stripTrailingReceiptOdds(rawSelection, odds, markers.length > 1);
      if (markers.length > 1 && selection !== rawSelection && selectionOdds) {
        const legOdds = oddsFrom(selectionOdds[1]);
        if (legOdds > 1) selection = `${selection} · delodds ${legOdds.toFixed(2)}`;
      }
      const rawMatch = clean(section.match(/(?:^|\n)\s*\d{1,2}[.)]\s+(?=[^\n]*[A-Za-zÆØÅæøå])([^\n]{2,100})/m)?.[1] || section.match(/Kamp\s*:?\s*([^\n]+)/i)?.[1] || sectionLoose?.match || fallbackMatch);
      const rawKickoff = clean(section.match(/Starttid\s*:?\s*([\s\S]*?)(?=\s*(?:Konkurranse|Spillobjekt))/i)?.[1] || section.match(/Kampstart\s*:?\s*([^\n]+)/i)?.[1] || '');
      const normalizedKickoff = clean(sectionLoose?.kickoff || '');
      const kickoff = /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}$/.test(normalizedKickoff)
        ? normalizedKickoff
        : (/^(?:\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\s+|I\s*(?:dag|morgen)\s*)\d{1,2}[:.]\d{2}$/i.test(rawKickoff) ? rawKickoff : normalizedKickoff);
      const competition = clean(section.match(/Konkurranse\s*:?\s*([\s\S]*?)(?=\s*Spillobjekt)/i)?.[1] || sectionLoose?.competition || '');
      const match = eventMatchFallback(rawMatch, market, competition);
      return mergeDraftData({ id: crypto.randomUUID(), groupId, match, kickoff, competition, coupon, category: inferCategory(market), market, selection, odds: String(odds || ''), stake, payout, sourceName, sourcePreview }, sectionLoose);
    };
    if (markers.length <= 1) return [parseSection(block)];
    return markers.map((marker, markerIndex) => parseSection(block.slice(marker.index, markers[markerIndex + 1]?.index ?? block.length), clean(marker[1])));
  });

  return text.split(/\n\s*---+\s*\n/)
    .map((block) => looseDraftFromText(block, sourceName, sourcePreview))
    .filter((item): item is ImportDraft => Boolean(item));
}


function draftCompletenessScore(item: ImportDraft) {
  let score = 0;
  if (!invalidMatchCandidate(item.match) && !competitionOnlyMatch(item.match, item.competition)) score += headToHeadMatch(item.match) ? 45 : 18;
  if (clean(item.market)) score += semanticMarketLine(item.market) ? 55 : 24;
  if (!invalidSelectionCandidate(item.selection)) score += semanticSelectionLine(item.selection) ? 50 : 22;
  if (/(?:\d{1,2}[/.]\d{1,2}|\d{1,2}:\d{2})/.test(item.kickoff)) score += 18;
  if (/(?:world cup|fotball.?vm|vm\s*2026|international|internasjonal|spesialer)/i.test(item.competition)) score += 16;
  if (/^\d{6,}(?:\.\d+)?$/.test(item.coupon)) score += 20;
  if (oddsFrom(item.odds) > 1) score += 18;
  if (numberFrom(item.stake) > 0) score += 18;
  if (numberFrom(item.payout) > 0) score += 18;
  const odds = oddsFrom(item.odds); const stake = numberFrom(item.stake); const payout = numberFrom(item.payout);
  if (odds > 1 && stake > 0 && payout > 0) {
    const error = Math.abs((odds * stake) - payout) / Math.max(1, payout);
    score += error <= .02 ? 35 : error <= .06 ? 8 : -25;
  }
  return score;
}

type DraftTextField = 'match' | 'kickoff' | 'competition' | 'coupon' | 'market' | 'selection';

function draftFieldScore(field: DraftTextField, value: string) {
  const normalized = clean(value);
  if (!normalized) return -1000;
  if (field === 'match') return invalidMatchCandidate(normalized) || competitionOnlyMatch(normalized) ? -500 : (headToHeadMatch(normalized) ? 100 : 25);
  if (field === 'market') return semanticMarketLine(normalized) ? 110 + Math.min(35, normalized.length / 3) : 20;
  if (field === 'selection') return invalidSelectionCandidate(normalized) ? -500 : (semanticSelectionLine(normalized) ? 105 + Math.min(30, normalized.length / 3) : (semanticMarketLine(normalized) ? -100 : 18));
  if (field === 'kickoff') return /(?:\d{1,2}[/.]\d{1,2}|\d{1,2}:\d{2})/.test(normalized) ? 90 : (normalized === 'Tidspunkt ikke oppgitt' ? -20 : 12);
  if (field === 'competition') return /(?:world cup|fotball.?vm|vm\s*2026|international|internasjonal|spesialer)/i.test(normalized) ? 80 : 16;
  return /^\d{6,}(?:\.\d+)?$/.test(normalized) ? 100 : 5;
}

function bestDraftField(items: ImportDraft[], field: DraftTextField, fallback: string) {
  return items.map((item) => clean(item[field])).filter(Boolean)
    .sort((a, b) => draftFieldScore(field, b) - draftFieldScore(field, a))[0] || fallback;
}

function bestEconomicDraft(items: ImportDraft[], fallback: ImportDraft) {
  const complete = items.filter((item) => oddsFrom(item.odds) > 1 && numberFrom(item.stake) > 0 && numberFrom(item.payout) > 0);
  if (!complete.length) return fallback;
  return [...complete].sort((a, b) => {
    const quality = (item: ImportDraft) => {
      const odds = oddsFrom(item.odds); const stake = numberFrom(item.stake); const payout = numberFrom(item.payout);
      const relativeError = Math.abs((odds * stake) - payout) / Math.max(1, payout);
      return relativeError * 1000 - draftCompletenessScore(item);
    };
    return quality(a) - quality(b);
  })[0];
}

function mergeDraftCandidates(items: ImportDraft[]) {
  const candidates = items.filter(Boolean);
  if (!candidates.length) return null;
  const base = [...candidates].sort((a, b) => draftCompletenessScore(b) - draftCompletenessScore(a))[0];
  const economic = bestEconomicDraft(candidates, base);
  const market = bestDraftField(candidates, 'market', base.market);
  const merged: ImportDraft = {
    ...base,
    match: eventMatchFallback(bestDraftField(candidates, 'match', base.match), market, bestDraftField(candidates, 'competition', base.competition)),
    kickoff: bestDraftField(candidates, 'kickoff', base.kickoff),
    competition: bestDraftField(candidates, 'competition', base.competition),
    coupon: bestDraftField(candidates, 'coupon', base.coupon),
    market,
    selection: bestDraftField(candidates, 'selection', base.selection),
    odds: economic.odds || base.odds,
    stake: economic.stake || base.stake,
    payout: economic.payout || base.payout,
    category: inferCategory(market),
  };
  merged.groupId = merged.coupon || base.groupId;
  return merged;
}

export function parseCouponCandidates(texts: string[], sourceName?: string, sourcePreview?: string): ImportDraft[] {
  const attempts = texts.map((text) => parseCouponText(text, sourceName, sourcePreview)).filter((items) => items.length > 0);
  if (!attempts.length) return [];
  const base = [...attempts].sort((a, b) => b.reduce((sum, item) => sum + draftCompletenessScore(item), 0) - a.reduce((sum, item) => sum + draftCompletenessScore(item), 0))[0];
  return base.map((baseItem, index) => {
    const sameCoupon = baseItem.coupon
      ? attempts.flatMap((items) => items.filter((item) => item.coupon === baseItem.coupon))
      : attempts.map((items) => items[index] || (items.length === 1 ? items[0] : undefined)).filter((item): item is ImportDraft => Boolean(item));
    return mergeDraftCandidates([baseItem, ...sameCoupon]) || baseItem;
  });
}

interface CouponBox { x: number; y: number; width: number; height: number; }
interface PixelImage { width: number; height: number; data: Uint8ClampedArray; }
interface CouponRegion { blob: Blob; ocrBlob: Blob; binaryBlob: Blob; previewUrl: string; box: CouponBox; sourceName: string; isDark: boolean; }

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

async function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Kunne ikke opprette bilde.')), type, quality));
}

function otsuThreshold(histogram: Uint32Array, total: number) {
  let totalValue = 0;
  for (let value = 0; value < 256; value += 1) totalValue += value * histogram[value];
  let backgroundWeight = 0; let backgroundValue = 0; let bestVariance = -1; let bestThreshold = 128;
  for (let threshold = 0; threshold < 256; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundValue += threshold * histogram[threshold];
    const backgroundMean = backgroundValue / backgroundWeight;
    const foregroundMean = (totalValue - backgroundValue) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) { bestVariance = variance; bestThreshold = threshold; }
  }
  return bestThreshold;
}

function histogramPercentile(histogram: Uint32Array, total: number, percentile: number) {
  const target = total * percentile; let count = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    count += histogram[value];
    if (count >= target) return value;
  }
  return 255;
}

function trimCouponWhitespace(source: HTMLCanvasElement) {
  const context = source.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context || source.width < 80 || source.height < 80) return source;
  const { width, height } = source;
  const image = context.getImageData(0, 0, width, height);
  const backgroundSamples: number[] = [];
  const sampleStepX = Math.max(1, Math.floor(width / 40)); const sampleStepY = Math.max(1, Math.floor(height / 60));
  for (let y = 0; y < height; y += sampleStepY) for (let x = 0; x < width; x += sampleStepX) {
    const offset = ((y * width) + x) * 4;
    backgroundSamples.push((image.data[offset] * .299) + (image.data[offset + 1] * .587) + (image.data[offset + 2] * .114));
  }
  backgroundSamples.sort((a, b) => a - b);
  const background = backgroundSamples[Math.floor(backgroundSamples.length / 2)] || 255;
  const active = (x: number, y: number) => {
    const offset = ((y * width) + x) * 4;
    const r = image.data[offset]; const g = image.data[offset + 1]; const b = image.data[offset + 2];
    const luma = (r * .299) + (g * .587) + (b * .114);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return Math.abs(luma - background) > 34 || chroma > 42;
  };
  const rowStep = Math.max(1, Math.floor(width / 500));
  const marginX = Math.max(2, Math.round(width * .045));
  const rowCounts: number[] = []; let rowSamples = 0;
  for (let y = 0; y < height; y += 1) {
    let count = 0; let samples = 0;
    for (let x = marginX; x < width - marginX; x += rowStep) { if (active(x, y)) count += 1; samples += 1; }
    rowCounts.push(count); rowSamples = samples;
  }
  const sortedRowCounts = [...rowCounts].sort((a, b) => a - b);
  const baselineActivity = sortedRowCounts[Math.floor(sortedRowCounts.length * .2)] || 0;
  const activeThreshold = baselineActivity + Math.max(4, Math.round(rowSamples * .012));
  const activeRows = rowCounts.flatMap((count, y) => count >= activeThreshold ? [y] : []);
  if (!activeRows.length) return source;
  const groups: Array<{ start: number; end: number }> = [];
  for (const y of activeRows) {
    const previous = groups.at(-1);
    if (previous && y - previous.end <= Math.max(8, Math.round(height * .012))) previous.end = y;
    else groups.push({ start: y, end: y });
  }
  let first = groups[0]; let last = first;
  const largeGap = Math.max(100, Math.round(height * .16));
  for (let index = 1; index < groups.length; index += 1) {
    if (groups[index].start - last.end > largeGap && last.end > height * .12) break;
    last = groups[index];
  }
  const padY = Math.max(18, Math.round(height * .025));
  const top = Math.max(0, first.start - padY);
  const bottom = Math.min(height, last.end + padY);
  let left = width; let right = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = marginX; x < width - marginX; x += rowStep) {
      if (!active(x, y)) continue;
      left = Math.min(left, x); right = Math.max(right, x);
    }
  }
  if (right <= left) return source;
  const padX = Math.max(18, Math.round(width * .035));
  left = Math.max(0, left - padX); right = Math.min(width - 1, right + padX);
  const cropWidth = right - left + 1; const cropHeight = bottom - top;
  if (cropWidth < 70 || cropHeight < 70 || (cropWidth > width * .94 && cropHeight > height * .94)) return source;
  const trimmed = document.createElement('canvas'); trimmed.width = cropWidth; trimmed.height = cropHeight;
  const trimmedContext = trimmed.getContext('2d', { alpha: false });
  if (!trimmedContext) return source;
  trimmedContext.fillStyle = background < 128 ? '#000' : '#fff'; trimmedContext.fillRect(0, 0, cropWidth, cropHeight);
  trimmedContext.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return trimmed;
}

async function prepareCouponCanvas(canvas: HTMLCanvasElement, box: CouponBox, sourceName: string): Promise<CouponRegion> {
  const preparedCanvas = trimCouponWhitespace(canvas);
  const targetWidth = 1400; const maximumWidth = 1900; const maximumHeight = 3400;
  const scale = Math.min(4, Math.max(1, targetWidth / Math.max(1, preparedCanvas.width)), maximumWidth / Math.max(1, preparedCanvas.width), maximumHeight / Math.max(1, preparedCanvas.height));
  const width = Math.max(1, Math.round(preparedCanvas.width * scale)); const height = Math.max(1, Math.round(preparedCanvas.height * scale));
  const normalized = document.createElement('canvas'); normalized.width = width; normalized.height = height;
  const context = normalized.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Canvas er ikke tilgjengelig.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(preparedCanvas, 0, 0, preparedCanvas.width, preparedCanvas.height, 0, 0, width, height);

  const sourcePixels = context.getImageData(0, 0, width, height);
  const grayscale = new Uint8Array(width * height); let lumaSum = 0;
  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4;
    const luma = Math.round((sourcePixels.data[offset] * .299) + (sourcePixels.data[offset + 1] * .587) + (sourcePixels.data[offset + 2] * .114));
    grayscale[index] = luma; lumaSum += luma;
  }
  const isDark = (lumaSum / Math.max(1, grayscale.length)) < 145;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < grayscale.length; index += 1) {
    const value = isDark ? 255 - grayscale[index] : grayscale[index];
    grayscale[index] = value; histogram[value] += 1;
  }
  const low = histogramPercentile(histogram, grayscale.length, .01);
  const high = histogramPercentile(histogram, grayscale.length, .99);
  const range = Math.max(28, high - low);
  const enhancedHistogram = new Uint32Array(256);
  const enhancedCanvas = document.createElement('canvas'); enhancedCanvas.width = width; enhancedCanvas.height = height;
  const enhancedContext = enhancedCanvas.getContext('2d', { alpha: false }); if (!enhancedContext) throw new Error('Canvas er ikke tilgjengelig.');
  const enhancedPixels = enhancedContext.createImageData(width, height);
  for (let index = 0; index < grayscale.length; index += 1) {
    const value = Math.max(0, Math.min(255, Math.round(((grayscale[index] - low) * 255) / range)));
    grayscale[index] = value; enhancedHistogram[value] += 1;
    const offset = index * 4;
    enhancedPixels.data[offset] = value; enhancedPixels.data[offset + 1] = value; enhancedPixels.data[offset + 2] = value; enhancedPixels.data[offset + 3] = 255;
  }
  enhancedContext.putImageData(enhancedPixels, 0, 0);

  const threshold = otsuThreshold(enhancedHistogram, grayscale.length);
  const binaryCanvas = document.createElement('canvas'); binaryCanvas.width = width; binaryCanvas.height = height;
  const binaryContext = binaryCanvas.getContext('2d', { alpha: false }); if (!binaryContext) throw new Error('Canvas er ikke tilgjengelig.');
  const binaryPixels = binaryContext.createImageData(width, height);
  for (let index = 0; index < grayscale.length; index += 1) {
    const value = grayscale[index] <= threshold ? 0 : 255;
    const offset = index * 4;
    binaryPixels.data[offset] = value; binaryPixels.data[offset + 1] = value; binaryPixels.data[offset + 2] = value; binaryPixels.data[offset + 3] = 255;
  }
  binaryContext.putImageData(binaryPixels, 0, 0);

  return {
    blob: await canvasToBlob(normalized),
    ocrBlob: await canvasToBlob(enhancedCanvas),
    binaryBlob: await canvasToBlob(binaryCanvas),
    previewUrl: normalized.toDataURL('image/jpeg', .9),
    box,
    sourceName,
    isDark,
  };
}

async function segmentCouponImage(file: File): Promise<CouponRegion[]> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) { bitmap.close(); throw new Error('Canvas er ikke tilgjengelig.'); }
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0);
  const boxes = detectCouponBoxes(context.getImageData(0, 0, canvas.width, canvas.height));
  const regions: CouponRegion[] = [];
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    const crop = document.createElement('canvas'); crop.width = Math.max(1, Math.round(box.width)); crop.height = Math.max(1, Math.round(box.height));
    const cropContext = crop.getContext('2d', { alpha: false }); if (!cropContext) continue;
    cropContext.fillStyle = '#fff'; cropContext.fillRect(0, 0, crop.width, crop.height);
    cropContext.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, crop.width, crop.height);
    regions.push(await prepareCouponCanvas(crop, box, `${file.name} · utsnitt ${index + 1}`));
  }
  bitmap.close();
  return regions;
}

interface OcrBox { x0: number; y0: number; x1: number; y1: number; }
interface OcrWord { text: string; bbox: OcrBox; confidence?: number; conf?: number; }
interface OcrLine { text: string; bbox: OcrBox; words?: OcrWord[]; confidence?: number; conf?: number; }
interface OcrBlock { paragraphs?: Array<{ lines?: OcrLine[] }>; }

interface PositionedOcrRow {
  text: string;
  bbox: OcrBox;
  lines: OcrLine[];
  confidence: number;
}

const NORWEGIAN_MONTHS: Record<string, number> = {
  januar: 1, februar: 2, mars: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

function unionOcrBoxes(boxes: OcrBox[]): OcrBox {
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

function ocrLineConfidence(line: OcrLine) {
  const direct = Number(line.confidence ?? line.conf ?? 0);
  if (direct > 0) return direct;
  const values = (line.words || []).map((word) => Number(word.confidence ?? word.conf ?? 0)).filter((value) => value > 0);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizedPositionedText(value: string) {
  return clean(normalizeOcrText(value).replace(/\n/g, ' '));
}

export function buildPositionedOcrRows(blocks: unknown): PositionedOcrRow[] {
  const lines = ((blocks || []) as OcrBlock[])
    .flatMap((block) => block.paragraphs || [])
    .flatMap((paragraph) => paragraph.lines || [])
    .map((line) => ({ ...line, text: normalizedPositionedText(line.text) }))
    .filter((line) => line.text && line.bbox && Number.isFinite(line.bbox.x0) && Number.isFinite(line.bbox.y0));
  if (!lines.length) return [];

  const heights = lines.map((line) => Math.max(1, line.bbox.y1 - line.bbox.y0)).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 20;
  const tolerance = Math.max(4, medianHeight * .52);
  const sorted = [...lines].sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2;
    const by = (b.bbox.y0 + b.bbox.y1) / 2;
    return Math.abs(ay - by) <= tolerance ? a.bbox.x0 - b.bbox.x0 : ay - by;
  });

  const groups: OcrLine[][] = [];
  for (const line of sorted) {
    const center = (line.bbox.y0 + line.bbox.y1) / 2;
    let target = groups.find((group) => {
      const box = unionOcrBoxes(group.map((item) => item.bbox));
      const groupCenter = (box.y0 + box.y1) / 2;
      const overlap = Math.max(0, Math.min(box.y1, line.bbox.y1) - Math.max(box.y0, line.bbox.y0));
      const minimumHeight = Math.max(1, Math.min(box.y1 - box.y0, line.bbox.y1 - line.bbox.y0));
      return overlap / minimumHeight >= .38 || Math.abs(groupCenter - center) <= tolerance;
    });
    if (!target) { target = []; groups.push(target); }
    target.push(line);
  }

  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const confidences = ordered.map(ocrLineConfidence).filter((value) => value > 0);
    return {
      text: clean(ordered.map((line) => line.text).join(' ')),
      bbox: unionOcrBoxes(ordered.map((line) => line.bbox)),
      lines: ordered,
      confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0,
    };
  }).filter((row) => row.text).sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2;
    const by = (b.bbox.y0 + b.bbox.y1) / 2;
    return ay === by ? a.bbox.x0 - b.bbox.x0 : ay - by;
  });
}

function stripCouponIcons(value: string) {
  return clean(value.replace(/^[^A-Za-zÆØÅæøå0-9]+/, ''));
}

function positionedNoiseRow(value: string) {
  const key = receiptLineKey(value);
  return !key || /^(?:oddsen(?:\s+(?:singel|system|aktiv|levert))*|singel|system|aktiv|levert|hjem|spill|mine spill|profil|vis detaljer|skjul detaljer)$/.test(key) ||
    /^(?:4g|5g|wifi|volte|nfc)(?:\s|$)/.test(key) || /^\d{1,2}:\d{2}(?:\s+\d+)?$/.test(key);
}

function summaryLabelRow(value: string) {
  return /\b(?:Odds|Innsats|Mulig Premie)\b/i.test(normalizeOcrText(value));
}

function numericTokens(value: string): string[] {
  return value.match(/\d+(?:[ .]\d{3})*(?:[.,]\d{1,2})?/g) ?? [];
}

function summaryNumberFromRows(rows: PositionedOcrRow[], label: RegExp, isOdds = false) {
  const index = rows.findIndex((row) => label.test(normalizeOcrText(row.text)));
  if (index < 0) return 0;
  const row = rows[index];
  const labeled = labeledNumber(normalizeOcrText(row.text), label.source, isOdds);
  if (labeled > 0) return labeled;
  const withoutLabel = normalizeOcrText(row.text).replace(label, ' ');
  let tokens = numericTokens(withoutLabel);
  if (!tokens.length) {
    const rowHeight = Math.max(1, row.bbox.y1 - row.bbox.y0);
    const nearby = rows.slice(Math.max(0, index - 1), index + 2).filter((candidate) =>
      candidate !== row && !summaryLabelRow(candidate.text) &&
      Math.abs(((candidate.bbox.y0 + candidate.bbox.y1) / 2) - ((row.bbox.y0 + row.bbox.y1) / 2)) <= Math.max(32, rowHeight * 1.4));
    tokens = nearby.flatMap((candidate) => numericTokens(candidate.text));
  }
  const raw = tokens.at(-1) || '';
  return isOdds ? oddsFrom(raw) : numberFrom(raw);
}

function couponNumberFromRows(rows: PositionedOcrRow[]) {
  for (const row of [...rows].reverse()) {
    const normalized = row.text.replace(/[|]/g, ' ').replace(/(?<=\d),(?=\d)/g, '.');
    const match = normalized.match(/\b(?:Kupongnummer|ID|1D|lD|I0)\s*[:.]?\s*([0-9][0-9 .]{5,}(?:\.[0-9]+)?)/i);
    const coupon = clean((match?.[1] || '').replace(/\s/g, ''));
    if (/^\d{6,12}(?:\.\d+)?$/.test(coupon)) return coupon;
  }
  return '';
}

interface CouponDateParts { day: number; month: number; year: number; hour: number; minute: number; }

function parseCouponDateParts(value: string): CouponDateParts | null {
  const normalized = clean(value).toLocaleLowerCase('nb-NO').replace(/,/g, ' ');
  const weekday = '(?:(?:man(?:dag)?|tir(?:sdag)?|ons(?:dag)?|tor(?:sdag)?|fre(?:dag)?|l[øo]r(?:dag)?|s[øo]n(?:dag)?)\\.?\\s+)?';
  const named = normalized.match(new RegExp(`${weekday}(?:dato\\s*)?(\\d{1,2})\\.?\\s+(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)(?:\\s+(\\d{2,4}))?\\s+(?:kl\\.?\\s*)?(\\d{1,2})\\s*[:.]\\s*([0-9]{2})`, 'i'));
  if (named) {
    let year = Number(named[3] || new Date().getFullYear());
    if (year > 0 && year < 100) year += 2000;
    return { day: Number(named[1]), month: NORWEGIAN_MONTHS[named[2]], year, hour: Number(named[4]), minute: Number(named[5]) };
  }
  const numeric = normalized.match(new RegExp(`${weekday}(?:dato\\s*)?(\\d{1,2})\\s*[./-]\\s*(\\d{1,2})(?:\\s*[./-]\\s*(\\d{2,4}))?\\s+(?:kl\\.?\\s*)?(\\d{1,2})\\s*[:.]\\s*([0-9]{2})`, 'i'));
  if (!numeric) return null;
  let year = Number(numeric[3] || new Date().getFullYear());
  if (year > 0 && year < 100) year += 2000;
  return { day: Number(numeric[1]), month: Number(numeric[2]), year, hour: Number(numeric[4]), minute: Number(numeric[5]) };
}

function formatCouponDate(parts: CouponDateParts) {
  return `${String(parts.day).padStart(2, '0')}.${String(parts.month).padStart(2, '0')}.${String(parts.year).padStart(4, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function addCouponDays(parts: CouponDateParts, days: number): CouponDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute));
  return { day: date.getUTCDate(), month: date.getUTCMonth() + 1, year: date.getUTCFullYear(), hour: parts.hour, minute: parts.minute };
}

function validCouponDateParts(parts: CouponDateParts | null): parts is CouponDateParts {
  if (!parts || parts.year < 2000 || parts.year > 2100 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return false;
  if (parts.hour < 0 || parts.hour > 23 || parts.minute < 0 || parts.minute > 59) return false;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return date.getUTCFullYear() === parts.year && date.getUTCMonth() + 1 === parts.month && date.getUTCDate() === parts.day;
}

function normalizeAbsoluteKickoff(value: string) {
  const normalized = clean(value).replace(/\bIdag\b/gi, 'I dag');
  const parts = parseCouponDateParts(normalized);
  return validCouponDateParts(parts) ? formatCouponDate(parts) : '';
}

function purchaseDateFromRows(rows: PositionedOcrRow[]) {
  const candidates: string[] = [];
  rows.forEach((row, index) => {
    if (!/\bDato\b/i.test(row.text)) return;
    candidates.push(row.text);
    candidates.push(rows.slice(Math.max(0, index - 1), Math.min(rows.length, index + 3)).map((item) => item.text).join(' '));

    const rowHeight = Math.max(1, row.bbox.y1 - row.bbox.y0);
    const rowCenter = (row.bbox.y0 + row.bbox.y1) / 2;
    const sameBand = rows.filter((candidate) =>
      Math.abs(((candidate.bbox.y0 + candidate.bbox.y1) / 2) - rowCenter) <= Math.max(28, rowHeight * 1.6));
    candidates.push(sameBand.map((candidate) => candidate.text).join(' '));
  });

  // Fallback for OCR that misses the literal «Dato», but still reads the date.
  rows.slice(Math.floor(rows.length * .55)).forEach((row) => {
    if (/(?:januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember|\d{1,2}[./-]\d{1,2}).*\d{1,2}[:.]\d{2}/i.test(row.text)) candidates.push(row.text);
  });

  return candidates.find((candidate) => validCouponDateParts(parseCouponDateParts(candidate))) || candidates[0] || '';
}

function extractClock(value: string) {
  const separated = value.match(/(?:^|\D)([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?!\d)/);
  if (separated) return { hour: Number(separated[1]), minute: Number(separated[2]) };
  const compact = value.match(/\b([01]\d|2[0-3])([0-5]\d)\b/);
  return compact ? { hour: Number(compact[1]), minute: Number(compact[2]) } : null;
}

function resolvePositionedKickoff(rawValue: string, purchaseValue: string) {
  const raw = clean(rawValue).replace(/\bIdag\b/i, 'I dag');
  const absolute = normalizeAbsoluteKickoff(raw);
  if (absolute) return absolute;

  const time = extractClock(raw);
  const purchase = parseCouponDateParts(purchaseValue);
  if (!time || !validCouponDateParts(purchase)) return '';

  const numericDate = /\b(?:I\s*dag|Idag|I\s*morgen)\b/i.test(raw)
    ? null
    : raw.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (numericDate) {
    let year = Number(numericDate[3] || purchase.year);
    if (year > 0 && year < 100) year += 2000;
    const candidate = { day: Number(numericDate[1]), month: Number(numericDate[2]), year, hour: time.hour, minute: time.minute };
    return validCouponDateParts(candidate) ? formatCouponDate(candidate) : '';
  }

  const offset = /i\s*morgen/i.test(raw) ? 1 : 0;
  const date = addCouponDays({ ...purchase, hour: time.hour, minute: time.minute }, offset);
  return validCouponDateParts(date) ? formatCouponDate(date) : '';
}

function kickoffCandidateFromRows(rows: PositionedOcrRow[]) {
  const texts = rows.map((row) => clean(row.text));
  for (let index = 0; index < texts.length; index += 1) {
    const candidates = [texts[index], clean(`${texts[index]} ${texts[index + 1] || ''}`), clean(`${texts[index - 1] || ''} ${texts[index]}`)];
    for (const candidate of candidates) {
      const relative = candidate.match(/\b(?:I\s*dag|Idag|I\s*morgen)\s*\d{1,2}\s*[:.]\s*\d{2}\b/i)?.[0];
      if (relative) return relative;
      const compactRelative = candidate.match(/\b(?:I\s*dag|Idag|I\s*morgen)\s*(?:[01]\d|2[0-3])[0-5]\d\b/i)?.[0];
      if (compactRelative) return compactRelative;
      const absolute = candidate.match(/\b(?:(?:man|tir|ons|tor|fre|l[øo]r|s[øo]n)\.?\s*)?\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\s+\d{1,2}\s*[:.]\s*\d{2}\b/i)?.[0];
      if (absolute) return absolute;
    }
  }
  return '';
}

function removeKickoffCandidate(value: string) {
  return clean(value
    .replace(/\b(?:I\s*dag|Idag|I\s*morgen)\s*\d{1,2}[:.]\d{2}\b/gi, ' ')
    .replace(/\b(?:(?:man|tir|ons|tor|fre|l[øo]r|s[øo]n)\.?\s*)?\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\s+\d{1,2}[:.]\d{2}\b/gi, ' '));
}

function competitionCandidate(rows: PositionedOcrRow[], summaryStartY: number) {
  const singelIndex = rows.findIndex((row) => /^singel\b/i.test(clean(row.text)));
  const candidates = rows.map((row, index) => ({ row, index, text: stripCouponIcons(row.text) })).filter(({ row, text }) =>
    row.bbox.y0 < summaryStartY && /(?:internasjonal|fotball.?vm|vm\s*2026|premier league|champions league|europa league|spesialer|world cup)/i.test(text) &&
    !/\b(?:Odds|Innsats|Mulig Premie|Dato|ID)\b/i.test(text));
  return candidates.sort((a, b) => {
    const score = (item: typeof a) => {
      let value = 0;
      if (singelIndex >= 0 && item.index > singelIndex) value += Math.max(0, 100 - ((item.index - singelIndex) * 18));
      if (/internasjonal|spesialer|premier league|champions league/i.test(item.text)) value += 45;
      if (/^norges\b/i.test(item.text)) value -= 35;
      if (/\bI\s*(?:dag|morgen)\b/i.test(item.text)) value -= 55;
      value -= item.index;
      return value;
    };
    return score(b) - score(a);
  })[0] || null;
}

function stripTrailingSelectionOdds(row: PositionedOcrRow, summaryOdds: number, documentWidth: number) {
  const text = clean(row.text);
  const match = text.match(/^(.*\S)\s+(\d{1,3}(?:(?:[.,]|\s)\d{2}))\s*$/);
  if (!match) return { text, removed: false };
  if (/\b(?:over|under)\s*$/i.test(match[1])) return { text, removed: false };
  const candidate = oddsFrom(match[2]);
  const rightMost = row.lines.at(-1);
  const geographicallyRight = Boolean(rightMost && rightMost.bbox.x0 > documentWidth * .52 && /^\s*\d/.test(rightMost.text));
  if ((summaryOdds > 1 && Math.abs(candidate - summaryOdds) <= .02) || geographicallyRight) return { text: clean(match[1]), removed: true };
  return { text, removed: false };
}

function positionedFieldValue(rows: PositionedOcrRow[], label: RegExp, maximum = 6) {
  const labelIndex = rows.findIndex((row) => label.test(row.text));
  if (labelIndex < 0) return '';
  const values: string[] = [];
  const inline = clean(rows[labelIndex].text.replace(label, '').replace(/^\s*:?\s*/, ''));
  if (inline) values.push(inline);
  for (let index = labelIndex + 1; index < rows.length && values.length < maximum; index += 1) {
    const value = clean(rows[index].text);
    if (!value) continue;
    if (RECEIPT_FIELD_LABEL.test(value) || summaryLabelRow(value) || positionedNoiseRow(value) || /^\d{1,2}[.)]\s+/.test(value)) break;
    values.push(value);
  }
  return clean(values.join(' '));
}

function positionedOutcomeSelection(rows: PositionedOcrRow[], summaryOdds: number, documentWidth: number) {
  const labelIndex = rows.findIndex((row) => OUTCOME_LABEL.test(row.text));
  if (labelIndex < 0) return '';
  const values: string[] = [];

  const addValue = (row: PositionedOcrRow, value: string) => {
    const normalized = clean(value);
    if (!normalized || invalidSelectionCandidate(normalized)) return false;
    const stripped = stripTrailingSelectionOdds({ ...row, text: normalized }, summaryOdds, documentWidth);
    if (stripped.text) values.push(stripped.text);
    return stripped.removed;
  };

  const inline = clean(rows[labelIndex].text.replace(OUTCOME_LABEL, '').replace(/^\s*:?\s*/, ''));
  if (inline && addValue(rows[labelIndex], inline)) return clean(values.join(' '));

  for (let index = labelIndex + 1; index < rows.length && values.length < 5; index += 1) {
    const row = rows[index];
    const value = clean(row.text);
    if (!value) continue;
    if (RECEIPT_FIELD_LABEL.test(value) || summaryLabelRow(value) || positionedNoiseRow(value) || invalidSelectionCandidate(value) || /^\d{1,2}[.)]\s+/.test(value)) break;
    if (/^\d{1,3}(?:(?:[.,]|\s)\d{2})$/.test(value)) break;
    if (addValue(row, value)) break;
  }

  const selection = clean(values.join(' '));
  return invalidSelectionCandidate(selection) ? '' : selection;
}

function likelyTeamLine(value: string) {
  const text = removeKickoffCandidate(value);
  if (!text || text.length > 60 || /[?]/.test(text) || /\d/.test(text) || semanticMarketLine(text)) return false;
  if (/(?:fotball.?vm|world cup|spesialer|internasjonal)/i.test(text)) return false;
  return text.split(/\s+/).length <= 6 && /[A-Za-zÆØÅæøå]/.test(text);
}

function normalizeVersusMatch(value: string) {
  const parts = clean(value).split(/\s+(?:v|vs\.?|mot)\s+/i).map(clean).filter(Boolean);
  return parts.length === 2 ? `${parts[0]} vs ${parts[1]}` : clean(value);
}

function validPositionedMatch(value: string, market = '', competition = '') {
  const text = clean(value);
  return Boolean(eventMatchFallback(text, market, competition)) && !semanticMarketLine(text) && !/\b(?:I\s*dag|I\s*morgen)\b|\d{1,2}:\d{2}/i.test(text);
}

export function parsePositionedCoupon(blocks: unknown, sourceName?: string, sourcePreview?: string): ImportDraft | null {
  const rows = buildPositionedOcrRows(blocks);
  if (!rows.length) return null;
  const documentWidth = Math.max(...rows.map((row) => row.bbox.x1), 1);
  const summaryRows = rows.filter((row) => summaryLabelRow(row.text));
  const summaryStartY = summaryRows.length ? Math.min(...summaryRows.map((row) => row.bbox.y0)) : Number.POSITIVE_INFINITY;
  const competitionHit = competitionCandidate(rows, summaryStartY);
  const competition = clean(competitionHit?.text || '');
  const purchaseText = purchaseDateFromRows(rows);
  const coupon = couponNumberFromRows(rows);
  const odds = summaryNumberFromRows(rows, /\bOdds\b/i, true);
  const stake = summaryNumberFromRows(rows, /\bInnsats\b/i);
  const payout = summaryNumberFromRows(rows, /\bMulig Premie\b/i);

  const outcomeIndex = rows.findIndex((row) => OUTCOME_LABEL.test(row.text));
  if (outcomeIndex >= 0) {
    const labeledCompetition = positionedFieldValue(rows, /^Konkurranse\b/i);
    const labeledMarket = positionedFieldValue(rows, /^(?:Spillobjekt|Marked)\b/i);
    const labeledSelection = positionedOutcomeSelection(rows, odds, documentWidth);
    const kickoffLabelIndex = rows.findIndex((row) => /^(?:Starttid|Kampstart)\b/i.test(row.text));
    const competitionLabelIndex = rows.findIndex((row, index) => index > kickoffLabelIndex && /^Konkurranse\b/i.test(row.text));
    const kickoffRows = kickoffLabelIndex >= 0
      ? rows.slice(kickoffLabelIndex, competitionLabelIndex > kickoffLabelIndex ? competitionLabelIndex : kickoffLabelIndex + 3)
      : rows;
    const labeledKickoff = resolvePositionedKickoff(kickoffCandidateFromRows(kickoffRows), purchaseText);
    const matchRow = rows.find((row) => /^\s*\d{1,2}[.)]\s+(?=.*[A-Za-zÆØÅæøå])/.test(row.text));
    const labeledMatch = clean(matchRow?.text.replace(/^\s*\d{1,2}[.)]\s+/, '') || '');
    const item = draft();
    return reconcileDraftEconomics({
      ...item,
      sourceName,
      sourcePreview,
      groupId: coupon || item.groupId,
      match: eventMatchFallback(labeledMatch, labeledMarket, labeledCompetition),
      kickoff: labeledKickoff,
      competition: labeledCompetition,
      coupon,
      market: labeledMarket,
      selection: labeledSelection,
      category: inferCategory(labeledMarket),
      odds: String(odds || ''),
      stake: String(stake || ''),
      payout: String(payout || ''),
    });
  }

  const firstContentIndex = competitionHit ? competitionHit.index + 1 : Math.max(0, rows.findIndex((row) => /^singel\b/i.test(clean(row.text))) + 1);
  const contentRows = rows.slice(firstContentIndex).filter((row) =>
    row.bbox.y0 < summaryStartY && !positionedNoiseRow(row.text) && !summaryLabelRow(row.text) &&
    !/\b(?:Dato|ID)\b/i.test(row.text) && clean(row.text) !== competition);
  const kickoffRaw = kickoffCandidateFromRows(contentRows);
  const kickoff = resolvePositionedKickoff(kickoffRaw, purchaseText);

  let selectionIndex = -1;
  let selection = '';
  for (let index = contentRows.length - 1; index >= 0; index -= 1) {
    const row = contentRows[index];
    const numericOnly = /^\d{1,3}(?:(?:[.,]|\s)\d{2})$/.test(clean(row.text));
    if (numericOnly && odds > 1 && Math.abs(oddsFrom(row.text) - odds) <= .02) continue;
    const stripped = stripTrailingSelectionOdds(row, odds, documentWidth);
    if (!stripped.text || /^(?:I\s*dag|I\s*morgen)\b/i.test(stripped.text)) continue;
    if (stripped.removed || semanticSelectionLine(stripped.text) || index === contentRows.length - 1) {
      selectionIndex = index;
      selection = stripped.text;
      break;
    }
  }
  if (selectionIndex < 0 && contentRows.length) {
    selectionIndex = contentRows.length - 1;
    selection = stripTrailingSelectionOdds(contentRows[selectionIndex], odds, documentWidth).text;
  }

  let marketStart = -1;
  for (let index = 0; index < selectionIndex; index += 1) {
    if (semanticMarketLine(contentRows[index].text)) { marketStart = index; break; }
  }
  if (marketStart < 0 && selectionIndex > 0) marketStart = selectionIndex - 1;
  const market = marketStart >= 0 ? clean(contentRows.slice(marketStart, selectionIndex).map((row) => row.text).join(' ')) : '';

  const matchRows = contentRows.slice(0, Math.max(0, marketStart)).map((row) => removeKickoffCandidate(row.text)).filter((value) =>
    value && !positionedNoiseRow(value) && !summaryLabelRow(value) && clean(value) !== competition);
  let match = '';
  const explicitVersus = matchRows.find((value) => /\s(?:v|vs\.?|mot)\s/i.test(value));
  const special = /spesial/i.test(competition) || /vinner.*(?:vm|turnering)|golden boot|toppscorer/i.test(market);
  if (explicitVersus) match = normalizeVersusMatch(explicitVersus);
  else if (!special) {
    const teams = matchRows.filter(likelyTeamLine);
    if (teams.length >= 2) match = `${teams[0]} vs ${teams[1]}`;
  }
  if (!match) match = clean(matchRows.join(' '));
  if (!validPositionedMatch(match, market, competition)) match = '';

  if (!match && !market && !selection && !coupon && !odds && !stake && !payout) return null;
  const item = draft();
  return reconcileDraftEconomics({
    ...item,
    sourceName,
    sourcePreview,
    groupId: coupon || item.groupId,
    match,
    kickoff,
    competition,
    coupon,
    market,
    selection,
    category: inferCategory(market),
    odds: String(odds || ''),
    stake: String(stake || ''),
    payout: String(payout || ''),
  });
}

export function mergePositionedWithText(positioned: ImportDraft | null, textCandidates: ImportDraft[]) {
  const fallbackCandidate = mergeDraftCandidates(textCandidates);
  const fallback = fallbackCandidate ? reconcileDraftEconomics(fallbackCandidate) : null;
  const primary = positioned ? reconcileDraftEconomics(positioned) : null;
  if (!primary) return fallback ? [fallback] : [];
  if (!fallback) return [primary];

  const fallbackMatch = validPositionedMatch(fallback.match, fallback.market, fallback.competition) ? fallback.match : '';
  const primaryKickoff = normalizeAbsoluteKickoff(primary.kickoff);
  const fallbackKickoff = normalizeAbsoluteKickoff(fallback.kickoff);
  const couponValid = (value: string) => /^\d{6,12}(?:\.\d+)?$/.test(clean(value));
  const market = clean(primary.market) || clean(fallback.market);
  const primarySelection = invalidSelectionCandidate(primary.selection) ? '' : clean(primary.selection);
  const fallbackSelection = invalidSelectionCandidate(fallback.selection) ? '' : clean(fallback.selection);

  const mixed = reconcileDraftEconomics({
    ...primary,
    odds: oddsFrom(primary.odds) > 1 ? primary.odds : fallback.odds,
    stake: numberFrom(primary.stake) > 0 ? primary.stake : fallback.stake,
    payout: numberFrom(primary.payout) > 0 ? primary.payout : fallback.payout,
  });
  const economic = [primary, fallback, mixed]
    .filter((item) => oddsFrom(item.odds) > 1 && numberFrom(item.stake) > 0 && numberFrom(item.payout) > 0)
    .sort((a, b) => economicRelativeError({ odds: oddsFrom(a.odds), stake: numberFrom(a.stake), payout: numberFrom(a.payout) }) -
      economicRelativeError({ odds: oddsFrom(b.odds), stake: numberFrom(b.stake), payout: numberFrom(b.payout) }))[0] || mixed;

  const merged: ImportDraft = {
    ...primary,
    match: validPositionedMatch(primary.match, primary.market, primary.competition) ? primary.match : fallbackMatch,
    kickoff: primaryKickoff || fallbackKickoff,
    competition: clean(primary.competition) || (!/^Fotball-VM 2026$/i.test(clean(fallback.competition)) ? clean(fallback.competition) : ''),
    coupon: couponValid(primary.coupon) ? primary.coupon : (couponValid(fallback.coupon) ? fallback.coupon : ''),
    market,
    selection: primarySelection || fallbackSelection,
    odds: economic.odds,
    stake: economic.stake,
    payout: economic.payout,
    category: inferCategory(market),
  };
  merged.groupId = merged.coupon || primary.groupId;
  return [reconcileDraftEconomics(merged)];
}

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
  const context = crop.getContext('2d', { alpha: false });
  if (!context) { bitmap.close(); throw new Error('Canvas er ikke tilgjengelig.'); }
  context.fillStyle = '#fff'; context.fillRect(0, 0, crop.width, crop.height);
  context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, crop.width, crop.height); bitmap.close();
  return prepareCouponCanvas(crop, box, `${region.sourceName} · ${suffix}`);
}

export function detectOcrGridBoxes(width: number, height: number, blocks: unknown): CouponBox[] {
  const lines = ((blocks || []) as OcrBlock[]).flatMap((block) => block.paragraphs || []).flatMap((paragraph) => paragraph.lines || []);
  const words = lines.flatMap((line) => line.words || []);
  const candidates = [
    { kind: 'coupon', anchors: lines.filter((line) => /\b(?:ID|1D|lD)\s*[:.]?\s*\d{6,}/i.test(line.text)).map((line) => line.bbox) },
    { kind: 'coupon', anchors: words.filter((word) => /kupong|kupongnr|kupongnummer/i.test(word.text)).map((word) => word.bbox) },
    { kind: 'stake', anchors: words.filter((word) => /innsats/i.test(word.text)).map((word) => word.bbox) },
    { kind: 'stake', anchors: words.filter((word) => /oddsen/i.test(word.text)).map((word) => word.bbox) },
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


function ocrLabelCount(text: string) {
  const normalized = normalizeOcrText(text);
  return ['Innsats', 'Odds', 'Mulig Premie', 'Starttid', 'Konkurranse', 'Spillobjekt', 'Spilt utfall', 'Kupongnummer']
    .reduce((sum, label) => sum + (new RegExp(label, 'i').test(normalized) ? 1 : 0), 0);
}

function ocrTextScore(text: string, confidence = 0) {
  const normalized = normalizeOcrText(text);
  const structured = (normalized.match(/(?:\d{1,2}[.)]\s+[^\n]{2,80}|\d+[.,]\d{2}|\d{6,}\.\d+)/g) || []).length;
  return (ocrLabelCount(normalized) * 150) + (Math.min(12, structured) * 20) + Math.min(80, Math.max(0, confidence)) + Math.min(70, normalized.length / 18);
}

async function recognizeBestRegion(worker: Awaited<ReturnType<typeof createWorker>>, region: CouponRegion, includeBlocks = false) {
  const recognize = (image: Blob) => includeBlocks ? worker.recognize(image, {}, { blocks: true }) : worker.recognize(image);
  let best = await recognize(region.ocrBlob);
  let bestScore = ocrTextScore(best.data.text, Number(best.data.confidence || 0));
  if (region.isDark || bestScore < 750) {
    const binary = await recognize(region.binaryBlob);
    const binaryScore = ocrTextScore(binary.data.text, Number(binary.data.confidence || 0));
    if (binaryScore > bestScore) { best = binary; bestScore = binaryScore; }
  }
  if (!region.isDark && bestScore < 450) {
    const original = await recognize(region.blob);
    const originalScore = ocrTextScore(original.data.text, Number(original.data.confidence || 0));
    if (originalScore > bestScore) best = original;
  }
  return best;
}

function dedupeOcrLines(parts: string[]) {
  const seen = new Set<string>();
  return parts.flatMap((part) => normalizeOcrText(part).split('\n')).map(clean).filter((line) => {
    if (!line) return false;
    const key = line.toLocaleLowerCase('nb-NO').replace(/[^a-zæøå0-9]+/g, ' ').trim();
    if (key.length < 3 || seen.has(key)) return false;
    seen.add(key); return true;
  }).join('\n');
}

async function recognizeTiledText(worker: Awaited<ReturnType<typeof createWorker>>, region: CouponRegion) {
  const bitmap = await createImageBitmap(region.isDark ? region.binaryBlob : region.ocrBlob);
  if (bitmap.height / Math.max(1, bitmap.width) < 1.45) { bitmap.close(); return ''; }
  const tileHeight = Math.min(bitmap.height, Math.max(720, Math.round(bitmap.width * 1.35)));
  const tileStep = Math.max(1, Math.round(tileHeight * .88));
  const texts: string[] = [];
  for (let y = 0; y < bitmap.height; y += tileStep) {
    const top = Math.min(y, Math.max(0, bitmap.height - tileHeight));
    const height = Math.min(tileHeight, bitmap.height - top);
    const tile = document.createElement('canvas'); tile.width = bitmap.width; tile.height = height;
    const context = tile.getContext('2d', { alpha: false }); if (!context) continue;
    context.fillStyle = '#fff'; context.fillRect(0, 0, tile.width, tile.height);
    context.drawImage(bitmap, 0, top, bitmap.width, height, 0, 0, tile.width, height);
    texts.push((await worker.recognize(await canvasToBlob(tile))).data.text);
    if (top + height >= bitmap.height) break;
  }
  bitmap.close();
  return dedupeOcrLines(texts);
}

function importedDraftCoreComplete(item: ImportDraft) {
  const odds = oddsFrom(item.odds); const stake = numberFrom(item.stake); const payout = numberFrom(item.payout);
  const economicError = odds > 1 && stake > 0 && payout > 0 ? Math.abs((odds * stake) - payout) / Math.max(1, payout) : 1;
  const match = clean(item.match); const market = clean(item.market); const selection = clean(item.selection);
  return validPositionedMatch(match, market, item.competition) && market.length > 1 && selection.length > 0 &&
    !/\b(?:I\s*dag|I\s*morgen)\b|\d{1,2}:\d{2}|\s(?:v|vs\.?|mot)\s/i.test(selection) &&
    /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}$/.test(clean(item.kickoff)) && clean(item.competition).length > 2 &&
    /^\d{6,12}(?:\.\d+)?$/.test(clean(item.coupon)) && odds > 1 && stake > 0 && payout > 0 && economicError <= .06;
}

function ocrTextsComplete(texts: string[], region: CouponRegion) {
  return parseCouponCandidates(texts, region.sourceName, region.previewUrl).some(importedDraftCoreComplete);
}

function addUniqueOcrText(texts: string[], value: string) {
  const normalized = normalizeOcrText(value);
  if (!clean(normalized)) return;
  const key = normalized.toLocaleLowerCase('nb-NO').replace(/[^a-zæøå0-9]+/g, ' ').trim();
  if (!texts.some((text) => text.toLocaleLowerCase('nb-NO').replace(/[^a-zæøå0-9]+/g, ' ').trim() === key)) texts.push(normalized);
}

async function recognizeRegionTexts(worker: Awaited<ReturnType<typeof createWorker>>, region: CouponRegion, initialText = '') {
  const texts: string[] = [];
  addUniqueOcrText(texts, initialText);
  if (texts.length && ocrTextsComplete(texts, region)) return texts;

  const enhanced = await worker.recognize(region.ocrBlob);
  addUniqueOcrText(texts, enhanced.data.text);
  if (ocrTextsComplete(texts, region)) return texts;

  const binary = await worker.recognize(region.binaryBlob);
  addUniqueOcrText(texts, binary.data.text);
  if (ocrTextsComplete(texts, region)) return texts;

  const original = await worker.recognize(region.blob);
  addUniqueOcrText(texts, original.data.text);
  if (ocrTextsComplete(texts, region)) return texts;

  const tiledText = await recognizeTiledText(worker, region);
  addUniqueOcrText(texts, tiledText);
  const combined = dedupeOcrLines(texts);
  addUniqueOcrText(texts, combined);
  return texts;
}

function normalizeImportedDraft(item: ImportDraft) {
  const normalizedKickoff = normalizeAbsoluteKickoff(item.kickoff);
  return reconcileDraftEconomics({
    ...item,
    kickoff: normalizedKickoff || clean(item.kickoff),
    coupon: clean(item.coupon).replace(/\s/g, '').replace(/(?<=\d),(?=\d)/g, '.'),
  });
}

function reconcileImportedDrafts(items: ImportDraft[]) {
  const normalizedItems = items.map(normalizeImportedDraft);
  const knownByTime = new Map<string, Set<string>>();
  normalizedItems.forEach((item) => {
    const match = clean(item.match);
    const key = `${clean(item.kickoff).toLowerCase()}|${clean(item.competition).toLowerCase()}`;
    if (clean(item.kickoff) && match) {
      const matches = knownByTime.get(key) || new Set<string>(); matches.add(match); knownByTime.set(key, matches);
    }
  });
  return normalizedItems.map((item) => {
    if (clean(item.match)) return item;
    const key = `${clean(item.kickoff).toLowerCase()}|${clean(item.competition).toLowerCase()}`;
    const matches = [...(knownByTime.get(key) || [])];
    return matches.length === 1 ? { ...item, match: matches[0] } : item;
  });
}

export function draftErrors(item: ImportDraft) {
  const normalizedItem = normalizeImportedDraft(item);
  const errors: string[] = [];
  const match = clean(normalizedItem.match); const market = clean(normalizedItem.market); const selection = clean(normalizedItem.selection);
  const competition = clean(normalizedItem.competition); const kickoff = clean(normalizedItem.kickoff); const coupon = clean(normalizedItem.coupon);
  const suspicious = /\b(?:Spillobjekt|Spilt\s+utfall|Kupongnummer|Konkurranse|Mulig\s+premie|Innsats|Odds)\b/i;
  const acceptedMatch = eventMatchFallback(match, market, competition);
  const requiresHeadToHead = inferCategory(market) !== 'Spesial';

  if (!acceptedMatch || (requiresHeadToHead && !headToHeadMatch(acceptedMatch)) || normalizedItem.match.length > 110 || suspicious.test(match) || semanticMarketLine(match) || /\b(?:I\s*dag|I\s*morgen)\b|\d{1,2}:\d{2}/i.test(match)) {
    errors.push('Kamp/event må kontrolleres. Bruk lagene (for eksempel Frankrike vs Spania), ikke turneringsnavn, marked eller tidspunkt.');
  }
  if (!market || normalizedItem.market.length > 130 || /Spilt\s+utfall|Kupongnummer|Mulig\s+premie/i.test(market)) errors.push('Markedet må kontrolleres.');
  if (invalidSelectionCandidate(selection) || normalizedItem.selection.length > 180 || suspicious.test(selection) || /\b(?:I\s*dag|I\s*morgen)\b|\d{1,2}:\d{2}|\s(?:v|vs\.?|mot)\s/i.test(selection)) {
    errors.push('Spillvalget må kontrolleres. Det kan ikke inneholde kamp eller tidspunkt.');
  }
  if (market && selection && receiptLineKey(market) === receiptLineKey(selection)) errors.push('Marked og spillvalg kan ikke være identiske.');
  if (match && selection && receiptLineKey(match) === receiptLineKey(selection)) errors.push('Kamp/event og spillvalg kan ikke være identiske.');

  if (!/^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}$/.test(kickoff)) errors.push('Starttid må være på formatet DD.MM.YYYY HH:MM.');
  if (!competition || normalizedItem.competition.length > 100 || /Spillobjekt|Spilt\s+utfall|\bI\s*(?:dag|morgen)\b/i.test(competition)) errors.push('Turneringsnavnet må kontrolleres.');
  if (!/^\d{6,12}(?:\.\d+)?$/.test(coupon)) errors.push('Kupongnummer mangler eller har ugyldig format.');

  const odds = oddsFrom(normalizedItem.odds); const stake = numberFrom(normalizedItem.stake); const payout = numberFrom(normalizedItem.payout);
  if (!(odds > 1 && odds < 1000)) errors.push('Odds må være et tall mellom 1 og 1000.');
  if (!(stake > 0 && stake < 1_000_000)) errors.push('Innsats mangler eller er ugyldig.');
  if (!(payout > 0)) errors.push('Mulig premie mangler eller er ugyldig.');
  if (odds > 1 && market && new RegExp(`(?:^|\\s)${odds.toFixed(2).replace('.', '[.,]')}\\s*$`).test(market)) errors.push('Markedet ser ut til å inneholde spillvalgets odds.');
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

interface TeamPresentation {
  name: string;
  code: string;
  flagCode?: string;
}

function presentTeam(name: string): TeamPresentation {
  const trimmedName = name.trim();
  const known = resolveWorldCupTeam(trimmedName);
  if (known) return { ...known, flagCode: known.code };

  return {
    name: trimmedName,
    code: trimmedName.replace(/[^A-Za-zÆØÅæøå]/g, '').slice(0, 3).toUpperCase() || 'VM',
  };
}

function teamCodes(label: string) {
  const parts = label.split(/\s+(?:v|vs\.?|mot)\s+/i);
  return parts.length > 1
    ? { home: presentTeam(parts[0]), away: presentTeam(parts[1]), special: false as const }
    : { home: undefined, away: undefined, special: true as const };
}

function kickoffPresentation(value: string) {
  const parsed = value.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})$/);
  if (!parsed) {
    const fallback = value.match(/^(.*?)\s+(\d{1,2}:\d{2})$/);
    return {
      date: fallback?.[1] || value,
      time: fallback?.[2] || '',
      dateTime: undefined,
    };
  }

  const [, day, month, year, time] = parsed;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return {
    date: new Intl.DateTimeFormat('nb-NO', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(date),
    time,
    dateTime: `${year}-${month}-${day}T${time}`,
  };
}

function CountryFlag({ code }: { code: string }) {
  return (
    <span className="country-flag" aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}flags/world-cup-2026/${code}.svg`} alt="" />
    </span>
  );
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

interface MatchCouponBuilderProps {
  match: string;
  selectedCount: number;
  summary: ReturnType<typeof trackedSummary>;
  onClear: () => void;
}

function MatchCouponBuilder({ match, selectedCount, summary, onClear }: MatchCouponBuilderProps) {
  const possibleNet = Math.max(0, summary.payout - summary.stake);

  return (
    <section
      className="match-coupon-builder"
      aria-label={`Kupongbygger for ${match}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="match-builder-copy">
        <span className="match-builder-icon" aria-hidden="true">
          <Check size={16} strokeWidth={3} />
        </span>
        <div>
          <span className="eyebrow">Kampkupong</span>
          <strong>{selectedCount} spill valgt</strong>
          <small>{match}</small>
        </div>
      </div>
      <dl className="match-builder-metrics">
        <div>
          <dt>Samlet innsats</dt>
          <dd>{money.format(summary.stake)} kr</dd>
        </div>
        <div className="positive">
          <dt>Mulig premie</dt>
          <dd>{money.format(summary.payout)} kr</dd>
        </div>
        <div className="positive">
          <dt>Netto gevinst</dt>
          <dd>+{money.format(possibleNet)} kr</dd>
        </div>
      </dl>
      <button
        type="button"
        className="match-builder-clear"
        onClick={onClear}
        aria-label={`Fjern markerte spill for ${match}`}
      >
        Fjern valgene
      </button>
    </section>
  );
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
  useEffect(() => {
    if (bets.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
    else localStorage.removeItem(STORAGE_KEY);
  }, [bets]);

  const totals = useMemo(() => trackedSummary(bets), [bets]);
  const matchGroups = useMemo(() => [...new Set(bets.map((bet) => bet.match))].map((match) => ({ match, bets: bets.filter((bet) => bet.match === match) })), [bets]);
  const draftCouponCount = new Set(drafts.map((item) => item.coupon || item.groupId)).size;

  function toggleBet(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function clearSelectedForMatch(match: string) {
    const matchIds = new Set(bets.filter((bet) => bet.match === match).map((bet) => bet.id));
    setSelected((current) => new Set([...current].filter((id) => !matchIds.has(id))));
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

  function removeMatchWithCoupons(match: string) {
    const couponKeys = new Set(bets.filter((bet) => bet.match === match).map(couponKey));
    if (!couponKeys.size) return;

    const removedIds = new Set(
      bets.filter((bet) => couponKeys.has(couponKey(bet))).map((bet) => bet.id),
    );
    const remaining = bets.filter((bet) => !couponKeys.has(couponKey(bet)));
    const remainingMatches = new Set(remaining.map((bet) => bet.match));

    setBets(remaining);
    setSelected((current) => new Set([...current].filter((id) => !removedIds.has(id))));
    setFilters((current) => Object.fromEntries(
      Object.entries(current).filter(([storedMatch]) => remainingMatches.has(storedMatch)),
    ));

    if (draggedId && removedIds.has(draggedId)) endDrag();
    if (settlingId && removedIds.has(settlingId)) setSettlingId(null);
  }

  function confirmAndRemoveMatch(match: string) {
    const directBets = bets.filter((bet) => bet.match === match);
    const couponKeys = new Set(directBets.map(couponKey));
    const cascadingBets = bets.filter((bet) => couponKeys.has(couponKey(bet)));
    const affectedOtherMatches = new Set(
      cascadingBets.filter((bet) => bet.match !== match).map((bet) => bet.match),
    );

    const couponLabel = couponKeys.size === 1 ? 'kupong' : 'kuponger';
    const selectionLabel = cascadingBets.length === 1 ? 'spillvalg' : 'spillvalg';
    const crossMatchWarning = affectedOtherMatches.size
      ? `\n\n${affectedOtherMatches.size} andre kampkort påvirkes fordi kupongene også inneholder spill der.`
      : '';

    if (window.confirm(
      `Slett ${match}?\n\nDette fjerner ${couponKeys.size} ${couponLabel} og ${cascadingBets.length} ${selectionLabel}.${crossMatchWarning}\n\nHandlingen kan ikke angres.`,
    )) removeMatchWithCoupons(match);
  }

  function removeAllGamesAndCoupons() {
    setBets([]);
    setSelected(new Set());
    setFilters({});
    endDrag();
    setSettlingId(null);
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
    const normalized = reconcileImportedDrafts(items);
    setDrafts((current) => appendImport ? [...current, ...normalized] : normalized);
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
      const cachedRecognition = new Map<Blob, Awaited<ReturnType<typeof recognizeBestRegion>>>();
      for (let index = 0; index < initialRegions.length; index += 1) {
        activeRegionIndex = index;
        const region = initialRegions[index];
        const preliminary = await recognizeBestRegion(worker, region, true);
        const split = await splitRegionByOcrAnchors(region, preliminary.data.blocks);
        if (split.length > 1) finalRegions.push(...split);
        else { finalRegions.push(region); cachedRecognition.set(region.blob, preliminary); }
      }
      setDetectedRegions(finalRegions.length);
      progressTotal = finalRegions.length;
      const found: ImportDraft[] = [];
      for (let index = 0; index < finalRegions.length; index += 1) {
        activeRegionIndex = index;
        const region = finalRegions[index];
        const recognition = cachedRecognition.get(region.blob) || await recognizeBestRegion(worker, region, true);
        const positioned = parsePositionedCoupon(recognition.data.blocks, region.sourceName, region.previewUrl);
        const texts = await recognizeRegionTexts(worker, region, recognition.data.text);
        const textCandidates = parseCouponCandidates(texts, region.sourceName, region.previewUrl);
        const parsed = mergePositionedWithText(positioned, textCandidates);
        if (parsed.length) found.push(...parsed);
        else found.push({ ...draft(), sourceName: region.sourceName, sourcePreview: region.previewUrl });
        setOcrProgress((index + 1) / finalRegions.length);
      }
      acceptImportedDrafts(reconcileImportedDrafts(found));
    } catch (error) {
      console.error(error); setImportError('Bildelesingen kunne ikke fullføres. Sjekk nettilgangen til OCR-språkdataene, eller bruk tekstimport.');
    } finally { if (worker) await worker.terminate(); setOcrBusy(false); }
  }

  function updateDraft(id: string, field: keyof ImportDraft, value: string) {
    setDrafts((all) => all.map((item) => item.id === id ? { ...item, [field]: value, ...(field === 'market' ? { category: inferCategory(value) } : {}) } : item));
  }

  function commitImport() {
    const normalizedDrafts = reconcileImportedDrafts(drafts);
    setDrafts(normalizedDrafts);
    const invalid = normalizedDrafts.filter((item) => draftErrors(item).length > 0);
    if (invalid.length) return setImportError(`${invalid.length} ${invalid.length === 1 ? 'kupong har' : 'kuponger har'} feil som må rettes før lagring.`);
    const seenSelections = new Set<string>();
    const valid = normalizedDrafts.filter((item) => {
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
      return { id: crypto.randomUUID(), couponGroupId: item.groupId, match: clean(item.match), kickoff: clean(item.kickoff), competition: clean(item.competition), coupon: clean(item.coupon), category: item.category, market: clean(item.market), selection: clean(item.selection), odds, stake, payout: numberFrom(item.payout) || stake * odds };
    })]);
    setImportedCount(new Set(fresh.map((item) => item.coupon || item.groupId)).size); setImportStep('success'); setImportError(fresh.length ? '' : 'Kupongene finnes allerede i oversikten.');
  }

  return (
    <div className="odds-page" data-theme={theme}>
      <div className="odds-atmosphere" aria-hidden="true" />
      <main className="tracker-shell">
        <nav className="tracker-nav" aria-label="Oddsen Tracker">
          <a className="tracker-brand" href="#top" aria-label="Oddsen Tracker, til toppen"><span className="brand-orbit"><Trophy size={17} /></span><span><strong>Oddsen Tracker</strong><small>Din personlige kupongoversikt</small></span></a>
          <div className="nav-actions">
            {bets.length > 0 && <button className="nav-import" type="button" onClick={() => openImport('image')}><Upload size={15} /><span>Importer kupong</span></button>}
            <button className="theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Bytt til ${theme === 'dark' ? 'lyst' : 'mørkt'} tema`}><Sun className="sun-icon" size={17} /><Moon className="moon-icon" size={17} /></button>
          </div>
        </nav>

        <section id="top" className="world-cup-hero" style={{ '--hero-image': `url(${heroImage})` } as CSSProperties} aria-labelledby="hero-title">
          <div className="hero-copy"><span className="hero-kicker">Nord-Amerika 2026 · Turneringsoversikt</span><h1 id="hero-title">Fotball-VM <em>2026</em></h1><p>Samle VM-kupongene dine og følg innsats, odds og mulig premie på ett sted.</p><div className="market-pills"><span>Kampvinner</span><span>Målscorer</span><span>Toppscorer-odds</span><span>Turneringsvinner</span></div></div>
          <div className="hero-badge" aria-hidden="true"><b>26</b><span>World Cup</span></div>
          <dl className="hero-stats"><div><dt>VM-kuponger</dt><dd>{totals.coupons}</dd></div><div><dt>VM-innsats</dt><dd>{money.format(totals.stake)} kr</dd></div><div><dt>Høyeste odds</dt><dd>{totals.highest ? totals.highest.toFixed(2) : '—'}</dd></div></dl>
        </section>

        <section className="overview-card" aria-labelledby="overview-title">
          <div className="overview-copy"><span className="section-kicker">Oversikt</span><h2 id="overview-title">Mine <em>spill</em></h2><p>{bets.length ? 'Følg innsats, odds og mulig premie per kamp. Marker spill for å bygge en kampkupong.' : 'Arbeidsområdet er tomt. Start med skjermbilder, kupongtekst eller manuell registrering i importfeltet under.'}</p></div>
          <dl className="overview-stats"><div><dt>Kuponger</dt><dd>{totals.coupons}</dd></div><div><dt>Total innsats</dt><dd>{money.format(totals.stake)} kr</dd></div><div><dt>Høyeste mulige premie</dt><dd>{money.format(bets.reduce((max, bet) => Math.max(max, bet.payout), 0))} kr</dd></div><div><dt>Gjennomsnittlig odds</dt><dd>{totals.averageOdds ? totals.averageOdds.toFixed(2) : '—'}</dd></div></dl>
        </section>

        {bets.length > 0 ? <>
          {matchGroups.map((group) => {
            const filter = filters[group.match] || 'Alle';
            const visible = filter === 'Alle' ? group.bets : group.bets.filter((bet) => bet.category === filter);
            const groupTotals = trackedSummary(group.bets);
            const groupChosen = group.bets.filter((bet) => selected.has(bet.id));
            const groupChosenSummary = trackedSummary(groupChosen);
            const matchup = teamCodes(group.match);
            const lead = group.bets[0];
            const kickoff = kickoffPresentation(lead.kickoff);

            return (
              <section className="match-card" key={group.match} aria-label={group.match}>
                <header className="match-header">
                  <div className="match-header-main">
                    <div className="match-meta-line">
                      <span className="section-kicker">{lead.competition || 'Fotball-VM 2026'}</span>
                    </div>
                    <time className="match-kickoff" dateTime={kickoff.dateTime}>
                      <span>{kickoff.date}</span>
                      {kickoff.time && <strong>{kickoff.time}</strong>}
                    </time>
                    {matchup.special ? (
                      <h2 className="event-match-title">
                        <strong>{group.match}</strong>
                      </h2>
                    ) : (
                      <h2 className="match-versus" aria-label={`${matchup.home.name} mot ${matchup.away.name}`}>
                        <span className="match-team">
                          {matchup.home.flagCode && <CountryFlag code={matchup.home.flagCode} />}
                          <span className="team-wordmark">
                            <b>{matchup.home.code}</b>
                          </span>
                        </span>
                        <i aria-hidden="true">VS</i>
                        <span className="match-team">
                          {matchup.away.flagCode && <CountryFlag code={matchup.away.flagCode} />}
                          <span className="team-wordmark">
                            <b>{matchup.away.code}</b>
                          </span>
                        </span>
                      </h2>
                    )}
                  </div>
                  <div className="match-header-side">
                    <dl>
                      <div><dt>Kuponger</dt><dd>{groupTotals.coupons}</dd></div>
                      <div><dt>Innsats</dt><dd>{money.format(groupTotals.stake)} kr</dd></div>
                      <div><dt>Høyeste odds</dt><dd>{groupTotals.highest.toFixed(2)}</dd></div>
                    </dl>
                    <button
                      className="match-delete-button"
                      type="button"
                      onClick={() => confirmAndRemoveMatch(group.match)}
                      aria-label={`Slett ${group.match} og alle tilhørende kuponger`}
                      title="Slett kampen og alle kuponger som inneholder den"
                    >
                      <Trash2 size={14} /> Slett kamp
                    </button>
                  </div>
                </header>

                <div className="filter-bar" aria-label={`Filtrer spill for ${group.match}`}>
                  <div className="filter-tabs">
                    {CATEGORIES.map((category) => {
                      const count = category === 'Alle' ? group.bets.length : group.bets.filter((bet) => bet.category === category).length;
                      if (category !== 'Alle' && !count) return null;

                      return (
                        <button
                          key={category}
                          type="button"
                          className={filter === category ? 'active' : ''}
                          aria-pressed={filter === category}
                          onClick={() => setFilters((all) => ({ ...all, [group.match]: category }))}
                        >
                          {category}<span>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <span className="sort-guide">
                    <GripVertical size={18} strokeWidth={2.4} />
                    <span>Dra for å sortere</span>
                  </span>
                </div>
                <div className="bet-columns" aria-hidden="true">
                  <span /><span>Marked og spillvalg</span><span>Odds</span><span>Innsats</span><span>Mulig premie</span><span />
                </div>
                <div className="bet-list" role="listbox" aria-label={`Spill for ${group.match}`} aria-multiselectable="true">
                  {visible.map((bet) => {
                    const isSelected = selected.has(bet.id);
                    const dropClass = dropTarget?.id === bet.id ? `drop-${dropTarget.edge}` : '';
                    const key = couponKey(bet);
                    const couponBetCount = bets.filter((item) => couponKey(item) === key).length;
                    const netPayout = bet.payout - bet.stake;

                    return (
                      <article
                        key={bet.id}
                        className={`bet-row category-${categoryClass[bet.category]} ${draggedId === bet.id ? 'dragging' : ''} ${settlingId === bet.id ? 'settling' : ''} ${dropClass}`}
                        draggable
                        onDragStart={(event) => beginDrag(event, bet.id)}
                        onDragOver={(event) => markDrop(event, bet.id)}
                        onDrop={finishDrop}
                        onDragEnd={endDrag}
                        onClick={() => toggleBet(bet.id)}
                        onKeyDown={(event) => handleRowKeyDown(event, bet.id)}
                        role="option"
                        tabIndex={0}
                        aria-selected={isSelected}
                        aria-label={`${bet.category}. ${bet.market}: ${bet.selection}`}
                      >
                        <span className="drag-control" aria-hidden="true" title="Dra for å endre rekkefølge">
                          <GripVertical size={22} strokeWidth={2.4} />
                        </span>
                        <div className="bet-main">
                          <span className="bet-description">
                            <i className="category-badge" title={bet.category} aria-hidden="true">{categoryCode[bet.category]}</i>
                            <span className="bet-market">{bet.market}</span>
                            {bet.coupon && <small className="coupon-reference">Kupong {bet.coupon}</small>}
                            {isSelected && (
                              <span className="selected-indicator" aria-hidden="true">
                                <Check size={12} strokeWidth={3} /> Valgt
                              </span>
                            )}
                          </span>
                          <strong className="bet-title">{bet.selection}</strong>
                        </div>
                        <div className="bet-number bet-odds">
                          <span>Odds</span>
                          <strong>{bet.odds.toFixed(2)}</strong>
                        </div>
                        <div className="bet-number bet-stake">
                          <span>Innsats</span>
                          <strong>{money.format(bet.stake)} kr</strong>
                        </div>
                        <div className="bet-number bet-payout">
                          <span>Mulig premie</span>
                          <strong>{money.format(bet.payout)} kr</strong>
                          <small>{netPayout > 0 ? '+' : netPayout < 0 ? '−' : ''}{money.format(Math.abs(netPayout))} kr netto</small>
                        </div>
                        <button
                          className="delete-bet"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (window.confirm(`Slett kupong${bet.coupon ? ` ${bet.coupon}` : ''}? Dette fjerner ${couponBetCount} ${couponBetCount === 1 ? 'spillvalg' : 'spillvalg'}.`)) removeCoupon(key);
                          }}
                          aria-label={`Slett hele kupong${bet.coupon ? ` ${bet.coupon}` : ''}`}
                          title="Slett hele kupongen"
                        >
                          <Trash2 size={17} />
                          <span className="sr-only">Slett hele kupongen</span>
                        </button>
                      </article>
                    );
                  })}
                </div>
                <footer className="match-footer" aria-label={`Oppsummering for ${group.match}`}>
                  <span>Alle kuponger · mulig premie</span>
                  <strong>{money.format(groupTotals.payout)} kr</strong>
                </footer>
                {groupChosen.length > 0 && (
                  <MatchCouponBuilder
                    match={group.match}
                    selectedCount={groupChosen.length}
                    summary={groupChosenSummary}
                    onClear={() => clearSelectedForMatch(group.match)}
                  />
                )}
              </section>
            );
          })}
          <section className="workspace-danger-zone" aria-label="Administrer spill og kuponger"><div><strong>Slett alle kuponger</strong><span>Fjerner {matchGroups.length} {matchGroups.length === 1 ? 'kamp' : 'kamper'}, {bets.length} spillvalg og {totals.coupons} kuponger fra denne nettleseren.</span></div><button className="delete-all-button" type="button" onClick={() => { if (window.confirm(`Slett alle spill og kuponger?\n\nDette fjerner ${matchGroups.length} kampkort, ${bets.length} spillvalg og ${totals.coupons} kuponger.\n\nHandlingen kan ikke angres.`)) removeAllGamesAndCoupons(); }}><Trash2 size={17} /> Slett alle spill og kuponger</button></section>
        </> : <section className="empty-dashboard" aria-labelledby="empty-dashboard-title"><button className="empty-visual" type="button" onClick={() => openImport('image')} aria-label="Åpne import av kupong" title="Importer kupong"><Upload size={28} /></button><span className="section-kicker">Arbeidsområdet er klart</span><h2 id="empty-dashboard-title">Importer din første kupong</h2><p>Klikk på ikonet for å starte med skjermbilder. Kupongtekst og manuell registrering velges i samme importdialog.</p><div className="empty-methods" aria-label="Tilgjengelige importmetoder"><span><ImageIcon size={13} /> Skjermbilder</span><span><FileText size={13} /> Kupongtekst</span><span><Plus size={13} /> Manuelt</span></div></section>}
      </main>

      {importOpen && <div className="modal-backdrop" role="presentation">
        <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <header className="import-header"><div><span className="section-kicker">{importStep === 'review' ? 'Kontroller før lagring' : importStep === 'success' ? 'Import fullført' : appendImport ? 'Utvid innlesningen' : 'Ny kupongimport'}</span><h2 id="import-title">{importStep === 'review' ? `${draftCouponCount} ${draftCouponCount === 1 ? 'kupong' : 'kuponger'} · ${drafts.length} spillvalg` : importStep === 'success' ? 'Kupongene er lagt til' : appendImport ? 'Importer flere kuponger' : 'Importer kupong'}</h2></div><button type="button" onClick={closeImport} aria-label="Lukk"><X /></button></header>
          {importStep === 'source' && <div className="import-body">
            <div className="import-tabs" role="tablist" aria-label="Velg importmetode"><button type="button" role="tab" aria-selected={importMode === 'image'} className={importMode === 'image' ? 'active' : ''} onClick={() => { setImportMode('image'); setImportError(''); }}><ImageIcon size={16} /> Skjermbilder</button><button type="button" role="tab" aria-selected={importMode === 'text'} className={importMode === 'text' ? 'active' : ''} onClick={() => { setImportMode('text'); setImportError(''); }}><FileText size={16} /> Kupongtekst</button></div>
            {importMode === 'image' ? <><input id="coupon-images" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) addFiles(event.target.files); event.currentTarget.value = ''; }} /><label className="dropzone" htmlFor="coupon-images" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}><Upload size={30} /><strong>Slipp skjermbilder her</strong><span>eller klikk for å velge PNG, JPG eller WEBP · maks 8 bilder</span></label>{uploadFiles.length > 0 && <div className="image-queue">{uploadFiles.map((item) => <figure key={item.url}><img src={item.url} alt={item.file.name} /><figcaption>{item.file.name}</figcaption><button type="button" onClick={() => { URL.revokeObjectURL(item.url); setUploadFiles((all) => all.filter((file) => file.url !== item.url)); }} aria-label={`Fjern ${item.file.name}`}><X size={14} /></button></figure>)}</div>}{ocrBusy && <div className="ocr-progress"><div><Loader2 className="spin" size={17} /><span>{detectedRegions ? `${detectedRegions} kupongområder funnet` : 'Deler bildet i kuponger'} · {Math.round(ocrProgress * 100)} %</span></div><i style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div>}</> : <label className="text-source">Kupongtekst<textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'Lim inn én eller flere kvitteringer her…\n\nInnsats: 100,00\nOdds: 2.10\nMulig Premie: 210,00\n1. Norge v England\nStarttid: 11/7 23:00\nSpillobjekt: Scorer mål\nSpilt utfall: Erling Haaland'} /></label>}
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
