export interface WorldCupTeam {
  name: string;
  code: string;
}

type TeamEntry = readonly [code: string, name: string, aliases: readonly string[]];

const teams: readonly TeamEntry[] = [
  ['ALG', 'Algerie', ['Algerie', 'Algeria']],
  ['ARG', 'Argentina', ['Argentina']],
  ['AUS', 'Australia', ['Australia']],
  ['AUT', 'Østerrike', ['Østerrike', 'Austria']],
  ['BEL', 'Belgia', ['Belgia', 'Belgium']],
  ['BIH', 'Bosnia-Hercegovina', ['Bosnia-Hercegovina', 'Bosnia og Hercegovina', 'Bosnia and Herzegovina', 'Bosnia Herzegovina']],
  ['BRA', 'Brasil', ['Brasil', 'Brazil']],
  ['CAN', 'Canada', ['Canada']],
  ['CIV', 'Elfenbenskysten', ['Elfenbenskysten', 'Côte d’Ivoire', "Cote d'Ivoire", 'Ivory Coast']],
  ['COD', 'DR Kongo', ['DR Kongo', 'Kongo DR', 'Congo DR', 'DR Congo']],
  ['COL', 'Colombia', ['Colombia']],
  ['CPV', 'Kapp Verde', ['Kapp Verde', 'Cabo Verde', 'Cape Verde']],
  ['CRO', 'Kroatia', ['Kroatia', 'Croatia']],
  ['CUW', 'Curaçao', ['Curaçao', 'Curacao']],
  ['CZE', 'Tsjekkia', ['Tsjekkia', 'Czechia', 'Czech Republic']],
  ['ECU', 'Ecuador', ['Ecuador']],
  ['EGY', 'Egypt', ['Egypt']],
  ['ENG', 'England', ['England']],
  ['ESP', 'Spania', ['Spania', 'Spain']],
  ['FRA', 'Frankrike', ['Frankrike', 'France']],
  ['GER', 'Tyskland', ['Tyskland', 'Germany']],
  ['GHA', 'Ghana', ['Ghana']],
  ['HAI', 'Haiti', ['Haiti']],
  ['IRN', 'Iran', ['Iran', 'IR Iran']],
  ['IRQ', 'Irak', ['Irak', 'Iraq']],
  ['JOR', 'Jordan', ['Jordan']],
  ['JPN', 'Japan', ['Japan']],
  ['KOR', 'Sør-Korea', ['Sør-Korea', 'Sør Korea', 'South Korea', 'Korea Republic']],
  ['KSA', 'Saudi-Arabia', ['Saudi-Arabia', 'Saudi Arabia']],
  ['MAR', 'Marokko', ['Marokko', 'Morocco']],
  ['MEX', 'Mexico', ['Mexico', 'Mexico']],
  ['NED', 'Nederland', ['Nederland', 'Netherlands', 'Holland']],
  ['NOR', 'Norge', ['Norge', 'Norway']],
  ['NZL', 'New Zealand', ['New Zealand']],
  ['PAN', 'Panama', ['Panama']],
  ['PAR', 'Paraguay', ['Paraguay']],
  ['POR', 'Portugal', ['Portugal']],
  ['QAT', 'Qatar', ['Qatar']],
  ['RSA', 'Sør-Afrika', ['Sør-Afrika', 'Sør Afrika', 'South Africa']],
  ['SCO', 'Skottland', ['Skottland', 'Scotland']],
  ['SEN', 'Senegal', ['Senegal']],
  ['SUI', 'Sveits', ['Sveits', 'Switzerland']],
  ['SWE', 'Sverige', ['Sverige', 'Sweden']],
  ['TUN', 'Tunisia', ['Tunisia']],
  ['TUR', 'Tyrkia', ['Tyrkia', 'Türkiye', 'Turkiye', 'Turkey']],
  ['URU', 'Uruguay', ['Uruguay']],
  ['USA', 'USA', ['USA', 'United States', 'United States of America']],
  ['UZB', 'Usbekistan', ['Usbekistan', 'Uzbekistan']],
] as const;

function teamKey(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('nb-NO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]/g, '');
}

const teamsByAlias = new Map<string, WorldCupTeam>();

for (const [code, name, aliases] of teams) {
  const team = { code, name };
  teamsByAlias.set(teamKey(code), team);
  for (const alias of aliases) teamsByAlias.set(teamKey(alias), team);
}

export function resolveWorldCupTeam(value: string) {
  return teamsByAlias.get(teamKey(value));
}

export const WORLD_CUP_TEAM_COUNT = teams.length;
