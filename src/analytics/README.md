# Analysemodul

Alle funksjoner er rene og muterer ikke input. Dataserier utelater `null`,
`undefined`, `NaN` og uendelige tall. Resultater som ikke kan beregnes returneres
som `null`; aggregater oppgir i tillegg antall utilgjengelige observasjoner.

`standardDeviation` bruker populasjonsstandardavvik (`N`) som standard. Velg
`sample` for et utvalg med Bessels korreksjon (`N - 1`); dette krever minst to
gyldige observasjoner. Over/under-linjer behandler lik verdi som push og tar den
ikke med i treffprosentens nevner. Oddsfunksjonene forventer desimalodds over 1,
og sannsynligheter uttrykkes fra 0 til 1.
