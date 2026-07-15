import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { detectCouponBoxes, draftErrors, parseCouponText } from '../src/features/betting/OddsenTracker.tsx';
import manifest from '../src/features/betting/__fixtures__/coupon-screenshots/manifest.json';
import transcripts from '../src/features/betting/__fixtures__/coupon-screenshots/ocr-transcripts.json';

const fixtureUrl = new URL('../src/features/betting/__fixtures__/coupon-screenshots/', import.meta.url);
const projection = ({ match, kickoff, competition, market, selection, odds, stake, payout, coupon, category }) => ({
  match, kickoff, competition, market, selection, odds, stake, payout, coupon, category,
});

describe('kanonisk kupongfixture-kontrakt', () => {
  it('pakker worker, core og begge OCR-språk lokalt for kald GitHub Pages-lasting', () => {
    const publicRoot = new URL('../public/ocr/tesseract/', import.meta.url);
    const assets = [
      'worker.min.js',
      'core/tesseract-core-lstm.wasm.js',
      'core/tesseract-core-simd-lstm.wasm.js',
      'core/tesseract-core-relaxedsimd-lstm.wasm.js',
      'lang/eng.traineddata.gz',
      'lang/nor.traineddata.gz',
    ];

    assets.forEach((asset) => expect(readFileSync(fileURLToPath(new URL(asset, publicRoot))).length, asset).toBeGreaterThan(100_000));
    for (const language of ['eng', 'nor']) {
      const bytes = readFileSync(fileURLToPath(new URL(`lang/${language}.traineddata.gz`, publicRoot)));
      expect([...bytes.subarray(0, 2)], language).toEqual([0x1f, 0x8b]);
    }
  });

  it('segmenterer hele Testkuponger-bildet til tre komplette rader og en ufullstendig siste rad', () => {
    const fixture = new URL('../src/features/betting/__fixtures__/coupon-screenshots/Testkuponger.jpg', import.meta.url);
    const bytes = readFileSync(fileURLToPath(fixture));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('c7b17ba9d450c1a7ab3ad400c0bd6d5054a5008bf99ed64adf7097bce474dfa1');

    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    const boxes = detectCouponBoxes({
      width: decoded.width,
      height: decoded.height,
      data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
    });
    const rows = boxes.reduce((all, box) => {
      const current = all.at(-1);
      if (current && Math.abs(current[0].y - box.y) < Math.min(current[0].height, box.height) * .35) current.push(box);
      else all.push([box]);
      return all;
    }, []);

    expect(boxes).toHaveLength(10);
    expect(new Set(boxes.map((box) => `${box.x}:${box.y}:${box.width}:${box.height}`)).size).toBe(10);
    boxes.forEach((box) => {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(decoded.width);
      expect(box.y + box.height).toBeLessThanOrEqual(decoded.height);
    });
    expect(rows.map((row) => row.length)).toEqual([3, 3, 3, 1]);
    rows.forEach((row) => expect(row.map((box) => box.x)).toEqual([...row].map((box) => box.x).sort((a, b) => a - b)));
  });

  it('bruker de uendrede originalbildene og låser fil til kupong', () => {
    for (const fixture of manifest) {
      const bytes = readFileSync(fileURLToPath(new URL(fixture.file, fixtureUrl)));
      expect(createHash('sha256').update(bytes).digest('hex'), fixture.file).toBe(fixture.sha256);
      expect(bytes.length, fixture.file).toBeGreaterThan(100_000);
    }
  });

  it('normaliserer hvert fixtures OCR-kontrakt til riktig kildebilde', () => {
    const results = manifest.map((fixture) => {
      const [draft] = parseCouponText(transcripts[fixture.file], fixture.file);
      expect(draft.sourceName).toBe(fixture.file);
      expect(projection(draft), fixture.file).toEqual(fixture.expected);
      expect(draftErrors(draft), fixture.file).toEqual([]);
      return [fixture.file, draft.coupon];
    });

    expect(results).toEqual(manifest.map((fixture) => [fixture.file, fixture.expected.coupon]));
  });
});
