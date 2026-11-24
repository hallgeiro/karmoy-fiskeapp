# Omriss av vann fra OpenStreetMap

> **Status: PLANLAGT – 2026-11-20.** Koden finnes; det som mangler, er å få kjørt den mot
> en Overpass-server som svarer.

## I dag

Vannene vises som punkt fra Kartverkets stedsnavnregister (SSR), uten omriss.
`scripts/hent-vann.mjs` prøver Overpass først, men fra byggemiljøet svarte ingen server:
`overpass-api.de` lukker forbindelsen, `overpass.kumi.systems` ga 502/504, og
`overpass.private.coffee` svarte ikke.

## Hva omriss gir

- Vannene tegnes som flater i grønt/rødt/gult, ikke bare markører.
- Sikrere kobling: et punkt i konfigurasjonen treffer vannet det ligger i, også for lange vann
  (Stiklevatnet, Vaulen) der markøren i dag kan ligge langt fra der man fisker.
- Sikrere kobling av GBIF-funn (punkt inne i vannet i stedet for «innen 250 m»).
- Areal per vann.

## Hvordan

1. Kjør `npm run vann:hent` fra en vanlig maskin (ikke byggemiljøet). Skriptet bruker OSM når
   Overpass svarer.
2. Les merknadene: navn som avviker, vann som ikke ble funnet. Rett med `punkt` eller `osm` i
   konfigurasjonen.
3. Sjekk i appen at de 43 fiskevannene og 15 forbudsvannene ligger riktig.
4. Commit `public/data/seed.sql` og publiser.

## Åpne spørsmål

- Vann som finnes i SSR men ikke i OSM (små tjern): skal de vises som punkt sammen med
  OSM-flatene? Skriptet lager i dag bare vann fra konfigurasjonen når de mangler.
