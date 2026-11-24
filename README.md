# Karmøy Fiskevann

Kart-app for ferskvannsfiske i Karmøy kommune. Den viser hvor du kan fiske og hvor du kjøper
fiskekort, hvor det er fiskeforbud, og hvor du må spørre grunneier – og har en personlig
fiskedagbok som virker uten nett.

**Prøv den:** <https://karmoyfiske.hallgeirolsen.com>
På mobil kan du legge den til på hjemskjermen (iPhone: Del → «Legg til på Hjem-skjerm»;
Android: meny → «Installer app»), så åpnes den som en app.

## Hva den gjør

- **Kart over 135 vann og tjern** på Kartverkets topografiske kart:
  - **Grønn** – de 43 godkjente fiskevannene i kommunens fiskekart, med sone, grunneierlag,
    Vipps og kjøpesteder, parkering og adkomst.
  - **Rød** – 15 vann med fiskeforbud (3 med vasspest).
  - **Gul** – andre vann: kontakt grunneier.
- **Fiskearter** med silhuetter, fra kommunens fiskekart og fiskefunn i GBIF.
- **Regler & kort** – barn under 16, fiskekortsonene, smittevern og fiskeravgift.
- **Fiskedagbok** – logg fangster med bilde og GPS-posisjon, skriv erfaringer per vann,
  se statistikk og tidslinje. Backup til en zip-fil.
- **Offline** – appen, vanndataene og loggen ligger på telefonen.

Opplysningene er hentet fra kommunens fiskekart (2012) og nettside, Kartverket og GBIF, og kan
være utdatert. Sjekk alltid med kommunen eller grunneier før du fisker.

## Dokumentasjon

| Fil | Innhold |
|---|---|
| [DESIGN.md](DESIGN.md) | Arkitektur, valg, hvordan vanndataene lages, kilder og lisenser |
| [CHANGELOG.md](CHANGELOG.md) | Endringer, nyeste øverst |
| [CLAUDE.md](CLAUDE.md) | Regler og kontekst for videre utvikling (også med Claude) |

## Utvikling

Krever Node 22+.

```bash
npm ci
npm run dev        # http://localhost:8787
npm test
npm run vann:hent  # oppdater vann og arter
npm run deploy     # publiser til Cloudflare
```

Ingen byggesteg – alt i `public/` serveres som det er. Endre fiskevann, forbud, soner og
kjøpesteder i konfigurasjonen øverst i `scripts/hent-vann.mjs`.

## Kilder

Kart og stedsnavn © Kartverket (CC BY 4.0) · fiskevann, soner og forbud fra Karmøy kommune ·
fiskefunn fra GBIF.org (CC BY 4.0) · omriss © OpenStreetMap-bidragsytere (ODbL) når de brukes.
Full liste med lisenser i [DESIGN.md](DESIGN.md#5-kilder-og-lisenser) og i appen under «© Kilder».
