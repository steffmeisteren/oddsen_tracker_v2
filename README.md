# Kampinnsikt

Kampinnsikt er en responsiv React/TypeScript-applikasjon for nøytral førkampanalyse. Den sammenstiller lag- og spillerdata, trender, markedsstatistikk og en lokal kupongbygger. Prosjektet leveres med et fullstendig syntetisk demo-datasett; det har ingen forbindelse til Norsk Tipping og gir ingen spillanbefalinger.

## Lokal oppstart

Krever Node.js 20 eller nyere.

```bash
pnpm install
pnpm dev
```

Åpne adressen Vite viser, normalt `http://localhost:5173`.

Kontroller hele løsningen med:

```bash
pnpm lint
pnpm test
pnpm build
```

## Arkitektur

- `src/types` inneholder stabile domenetyper, filtre og metadata.
- `src/data` inneholder datakildekontrakten, demo-adapteren og en HTTP-adapter.
- `src/analytics` inneholder rene statistikk- og bettingberegninger med Vitest-tester.
- `src/components` inneholder gjenbrukbare presentasjonskomponenter.
- `src/features/betting` inneholder markedsoversikt, korrelasjonsvarsler, kupong og eksport.
- `src/hooks` kapsler versjonert lokal lagring.

Alle visninger bruker `DataSourceMetadata` for å skille direkte, lokalt beregnede, estimerte og utilgjengelige data. Straffesparkkonkurranser er eksplisitt skilt fra ordinær kampstatistikk i metadata. Standard tidssone er `Europe/Oslo`.

## Koble til en ekte fotball-API

Implementer `FootballDataSource` i `src/data/FootballDataSource.ts`. `HttpFootballDataSource` i `src/data/api/HttpFootballDataSource.ts` er et eksempel som viser endepunkter og normalisering. En produksjonsadapter bør:

1. autentisere på en sikker server eller proxy, ikke eksponere en betalt API-nøkkel i nettleseren;
2. mappe leverandør-ID-er og navnealiaser til domenemodellene;
3. validere råresponsen med et skjema før data går til UI-et;
4. fylle `DataSourceMetadata` per måling, inkludert kilde, oppdateringstid og utvalgsstørrelse;
5. returnere `null`/tomt utvalg og `quality: unavailable` når kilden ikke støtter feltet;
6. holde ekstraomganger og straffesparkkonkurranser separat.

Etter adapteren er opprettet, byttes `mockFootballDataSource` i `src/App.tsx` med den nye implementasjonen. Komponenter og analysefunksjoner trenger ingen leverandørspesifikke endringer.

## Data som normalt krever avanserte eller betalte kilder

Følgende er bevisst ikke funnet på i demoen og vises som manglende når datagrunnlaget ikke finnes:

- forventede startoppstillinger og start-sannsynlighet;
- xG, xA, xGOT og skuddkoordinater med spillerkobling;
- store sjanser, berøringer i boksen, press, kontringer og farlige angrep;
- detaljert måltype, skuddposisjon, assisttype og spillsituasjon;
- kortårsak, trener-/benkekort og dommerhistorikk per turnering/lag;
- frisparksoner, direkte frisparkskudd og detaljert foul-kontekst;
- hvem som tar cornere, frispark og straffer, samt målvaktens historiske strafferedninger;
- verifiserte skader, suspensjoner og forventede lagoppstillinger;
- leverandørspesifikke Norsk Tipping-markeder og sanntidsodds;
- VAR-årsak og hendelser som avhenger av redaksjonell tagging.

## Lokal lagring og eksport

Filtre, lagvalg, egen sannsynlighet og lagrede kuponger lagres under `kampinnsikt:*` i `localStorage`. Nullstill-knappen fjerner bare disse nøklene. Kuponger kan eksporteres som JSON eller CSV. Kombinert implisitt sannsynlighet merkes som upålitelig når valg kan være korrelerte.

Se også [ARCHITECTURE.md](./ARCHITECTURE.md) og [analysemodulens dokumentasjon](./src/analytics/README.md).
