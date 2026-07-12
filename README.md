# Oddsen Tracker

En responsiv, nettleserbasert applikasjon for å importere, kontrollere og organisere Norsk Tipping-kuponger (fokus: VM 2026). Data lagres lokalt i nettleseren.

## Funksjoner

- **OCR-import**: Skann kuponger fra bilder.
- **Tekstimport**: Lim inn råtekst fra kuponger.
- **Manuell registrering**: Legg til spill manuelt.
- **Kontrollvisning**: Validering før lagring.
- **Lokal lagring**: Bruker `localStorage` for personvern.

## Kom i gang

### Forutsetninger
- Node.js (v20+)
- `pnpm`

### Installer og start
1. `pnpm install`
2. `pnpm dev`
3. Åpne `http://localhost:5173`

### Bygging
```bash
pnpm build
```

## Arkitektur

Prosjektet er organisert med fokus på kuponghåndtering:
- `src/features/betting/`: Hovedlogikk og CSS.

## Ansvarsfraskrivelse
Dette er et privat verktøy, ikke tilknyttet Norsk Tipping eller andre spillselskaper.