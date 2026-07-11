# Kampinnsikt – arkitektur

Applikasjonen er delt i fire lag: `types` definerer stabile datakontrakter, `data` normaliserer enhver leverandør til `FootballDataSource`, `analytics` gjør rene og testbare beregninger, og `components` presenterer resultatene. UI-et skal aldri gjette manglende statistikk; `DataSourceMetadata.quality` avgjør om en verdi er direkte, lokalt beregnet, estimert eller utilgjengelig.

Mock-adapteren er en fullverdig implementasjon av samme grensesnitt som en senere API-adapter. Ved integrasjon med en leverandør opprettes en ny adapter som mapper leverandørens felter til domenetypene, mens komponenter og beregninger forblir uendret.

Mapper:

- `src/types`: domene, filtre og metadata
- `src/data`: datakildekontrakt, adaptere og demo-data
- `src/analytics`: statistiske funksjoner uten UI-avhengigheter
- `src/components`: presentasjons- og funksjonsområder
- `src/hooks`: lokal tilstand og localStorage

Standard tidssone er `Europe/Oslo`. Straffesparkkonkurranser og ekstraomganger skal alltid merkes og holdes eksplisitt adskilt via metadata og filtre.
