# Kupongbilder for importregresjon

Disse filene er uendrede kopier av skjermbildene som utløste mobilfeilen. `manifest.json`
låser både SHA-256, koblingen mellom kildefil og kupongnummer, og forventet normalisert
resultat. `pnpm test:import-fixtures` verifiserer de faktiske bildebytene, låser
filkoblingen og kjører registrerte OCR-transkripter gjennom den kanoniske parseren.
I tillegg skal originalfilene kjøres gjennom den virkelige nettleserflyten før en
endring kan godkjennes; et preview- eller thumbnail-bilde er ikke en gyldig kilde.

| Fixture | Opprinnelig fil | Kupongnummer |
| --- | --- | --- |
| `3132.jpg` | `Screenshot_20260714_153616.jpg` | `301648248.1` |
| `3133.jpg` | `Screenshot_20260714_153622.jpg` | `301648357.1` |
| `3134.jpg` | `Screenshot_20260714_153631.jpg` | `301646869.1` |
| `3135.jpg` | `Screenshot_20260714_153747.jpg` | `301646585.1` |
| `special-event-norway-world-cup.jpg` | `Screenshot_20260711_221654.jpg` | `299102132.1` |

De fire nummererte filene skal beholde denne rekkefølgen også når OCR-jobbene
fullføres i en annen rekkefølge. Alle fire bruker kvitteringsdatoen 14. juli 2026
som referanse for `I dag 21:00`. Spesialeventet dokumenterer at et gyldig event uten
to lag ikke skal tvinges til et kunstig `vs`-navn.

JPEG-filene har en ugyldig EXIF-orienteringsverdi (`0`), men de dekodede pikslene er
allerede stående. Importen må derfor behandle ugyldig orientering som «ukjent» og
ikke rotere på grunnlag av denne verdien.
