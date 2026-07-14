import { describe, expect, it } from 'vitest';
import { resolveWorldCupTeam, WORLD_CUP_TEAM_COUNT } from './worldCupTeams';

describe('VM-flagg', () => {
  it('har alle 48 deltakerlag', () => {
    expect(WORLD_CUP_TEAM_COUNT).toBe(48);
  });

  it.each([
    ['Frankrike', 'FRA'],
    ['France', 'FRA'],
    ['Spania', 'ESP'],
    ['Sør-Korea', 'KOR'],
    ['Côte d’Ivoire', 'CIV'],
    ['Bosnia and Herzegovina', 'BIH'],
  ])('finner riktig flaggkode for %s', (name, code) => {
    expect(resolveWorldCupTeam(name)?.code).toBe(code);
  });
});
