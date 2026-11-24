# Prosjektkontekst for Claude

**Karmøy Fiskevann** er en kart-app (PWA) for ferskvannsfiske i Karmøy kommune.
Alt kjører i nettleseren: Leaflet-kart, SQLite WASM i OPFS i en egen Web Worker,
service worker for offline. Cloudflare serverer bare statiske filer fra `public/`
(ingen server-API, ingen database på server). Brukerens fangster, bilder og
erfaringer ligger bare på brukerens enhet.

- Arkitektur, valg og kilder: [DESIGN.md](DESIGN.md). Les den før større endringer.
- Hva appen er og hvordan man prøver den: [README.md](README.md).
- Endringer: [CHANGELOG.md](CHANGELOG.md).
- Planlagte forbedringer: [plans/](plans/README.md) – én fil per plan med statuslinje øverst.
- Live: <https://karmoyfiske.hallgeirolsen.com>
- Språk i appen, kodekommentarer og dokumentasjon: norsk bokmål.

## Kommandoer

```bash
npm ci                 # installer
npm run dev            # lokal server på http://localhost:8787 (skriver versjon.json først)
npm test               # vitest – tester for importskriptet
npm run vann:hent      # hent vann (Overpass → SSR) og arter (GBIF) → public/data/seed.sql
npm run deploy         # publiser til Cloudflare (skriver versjon.json først)
npm run vendor:sqlite  # kopier SQLite WASM fra node_modules til public/vendor/sqlite
```

Ingen byggesteg: filene i `public/` serveres som de er. Biblioteker ligger kopiert
i `public/vendor/` (Leaflet, SQLite WASM, JSZip).

## Regler – når du endrer X, gjør også Y

- **CHANGELOG.md – en oppføring for HVER endring**, skrevet i samme runde som koden.
  Legg den ØVERST i fila:

  ```md
  - **YYYY.MM.DD** (vVERSJON):
    Hva som er endret og, når det betyr noe, hvorfor – skrevet for den som bruker appen.
  ```

  `VERSJON` er versjonen endringen kommer i: `1.0.<antall commits + 1>`
  (`git rev-list --count HEAD` pluss én, siden commiten ikke er laget ennå).
  Flere endringer i samme commit deler overskrift som egne avsnitt. **Les
  dagens dato og commit-tallet når du skriver** – ikke kopier overskriften over.
  Gjenbruk en overskrift bare når både dato og versjon fortsatt stemmer.

- **Vanndata – kjør importen på nytt.** Endrer du fiskevann, forbud, soner,
  grunneierlag eller kjøpesteder i konfigurasjonen øverst i
  `scripts/hent-vann.mjs`, kjør `npm run vann:hent` og commit
  `public/data/seed.sql` sammen med endringen. Rediger aldri `seed.sql` for hånd.
  Grunneierlag og kjøpesteder finnes også i `public/app.js` (`GRUNNEIERLAG`,
  `KJØPESTEDER`) – hold dem like.

- **Brukerdata skal aldri røres av vanndata.** `seed.sql` dropper og lager bare
  `ferskvann`. Lager du en ny brukertabell: legg den i `BRUKERSKJEMA` og
  `BRUKERTABELLER` i `public/db-worker.js`, og ta den med i backup og
  gjenoppretting i `public/logg.js` (eldre backup uten tabellen skal ikke slette
  den). Ny endring i brukerdata skal kalle `merkEndret()` (backup-påminnelsen).

- **Ny fil i appen → offline-lista.** En ny fil under `public/` som appen laster,
  skal inn i `SHELL_FILES` i `public/sw.js`.

- **Ny datakilde eller nytt bibliotek → kildene.** Oppdater «© Kilder»-panelet i
  `public/index.html` og kildetabellen i `DESIGN.md` med lisens. Kopierte
  biblioteker i `public/vendor/` får lisensfil og versjon ved siden av seg.

- **Planer – hold status oppdatert.** Når en plan i `plans/` gjennomføres, sett
  statuslinja til `FERDIG (vX.Y.N)` og oppdater tabellen i `plans/README.md`.
  Nye ideer som ikke gjøres nå, får en egen fil eller en linje i `plans/mindre.md`.

- **Ikke gjett data.** Står det ikke i en kilde (kommunens fiskekart eller
  nettside, Kartverket, GBIF), skal appen si at det ikke er kjent – ikke finne
  på grunneierlag, priser, arter eller lenker. Brukerens egne merkinger skal
  alltid se annerledes ut enn kommunens status.

- **Test i nettleseren før publisering.** Endringer i `public/` testes med
  `npm run dev` og Playwright (Chromium er forhåndsinstallert). Sjekk både
  mobilbredde (390 px) og bred skjerm, og at konsollen er uten feil.

## Arbeidsmåte

Eieren bestemmer, Claude implementerer og sier fra når noe virker feil.
Vis en plan før endringer i mange filer. Commit og push til arbeidsgreina når
en endring er ferdig og testet; publiser (`npm run deploy`) når eieren ber om
det eller endringen gjelder appen eieren tester. Ikke skriv om git-historikken.

## Kodestil (vanlig JavaScript, ES-moduler)

- Del større filer i seksjoner med overskrifter:
  `// ---------- Navn på seksjon ----------`
- JSDoc på eksporterte funksjoner og på ikke-opplagte algoritmer: forklar
  hensikt og forutsetninger, ikke det koden åpenbart gjør.
- Navngitte konstanter i stedet for tall og strenger som står alene i koden
  (`const NETT_TIDSFRIST = 4000;`).
- Tidlig retur framfor dype `if`/ternære uttrykk.
- Navn på norsk der resten av fila er norsk; `æøå` er greit i navn.
- Ingen utkommentert kode – slett den.
- All tekst fra brukeren eller fra data settes inn via `esc()` før den havner i HTML.
