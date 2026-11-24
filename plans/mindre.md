# Mindre forbedringer

> **Status: SAMLELISTE – 2026-11-20.** Små ting som er sett, men ikke prioritert.

- **Strigvatn / Strigvatnet:** stedsnavnregisteret har to oppføringer ca. 300 m fra hverandre;
  markøren «Strigvatnet» ligger i det lange vannet ved Vaulen, mens kartets eget navn står ved
  det andre. Sjekk hvilken som er riktig, og om den andre skal fjernes eller få et `punkt`.
- **Karpe i tidslinjen:** med 40 % størrelse blir karpe-silhuetten ca. 16 px i tidslinjen.
  Vurder en minstestørrelse for små ikoner.
- **Grunneierlag for Avaldsnes:** ikke oppgitt av kommunen. Legg inn når det er kjent
  (`GRUNNEIERLAG` i `public/app.js`).
- **Tile-feil i konsollen:** Leaflet avbryter kartfliser når kartet flyr til et vann, og service
  workeren rapporterer det som feil. Ufarlig, men støyende ved feilsøking.
- **Kontaktinfo til grunneierlagene:** ikke oppgitt i kildene. Legg inn hvis eieren skaffer den.
