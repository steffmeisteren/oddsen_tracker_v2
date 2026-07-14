import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { draftErrors, parseCouponText } from '../src/features/betting/OddsenTracker.tsx';
import manifest from '../src/features/betting/__fixtures__/coupon-screenshots/manifest.json';
import transcripts from '../src/features/betting/__fixtures__/coupon-screenshots/ocr-transcripts.json';

const fixtureUrl = new URL('../src/features/betting/__fixtures__/coupon-screenshots/', import.meta.url);
const projection = ({ match, kickoff, competition, market, selection, odds, stake, payout, coupon, category }) => ({
  match, kickoff, competition, market, selection, odds, stake, payout, coupon, category,
});

describe('kanonisk kupongfixture-kontrakt', () => {
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
