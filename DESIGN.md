# Karmøy Fiskevann – design og valg

Karmøy Fiskevann er en kart-app for ferskvannsfiske i Karmøy kommune. Den viser hvilke vann
man kan fiske i (og hvor man kjøper fiskekort), hvilke vann det er forbudt å fiske i, og
hvilke vann der grunneier må spørres. I tillegg har den en personlig fiskedagbok med
fangster, bilder og erfaringer.

Live: <https://karmoy-fiskeapp.karmoy-fiskeapp.workers.dev>
Endringer: se [CHANGELOG.md](CHANGELOG.md).

---

## 1. Hovedprinsipper

| Prinsipp | Hva det betyr i praksis |
|---|---|
| **Alt kjører i nettleseren** | Ingen server-API og ingen database på server. Cloudflare serverer bare statiske filer. |
| **Fungerer offline** | Appen, vanndataene, fangstloggen og kartflisene du har sett, ligger lokalt. Viktig ute ved vannene der dekningen er dårlig. |
| **Brukerens data er brukerens** | Fangster, bilder og erfaringer ligger bare på brukerens enhet. Ingenting sendes noe sted. Backup er en zip-fil brukeren selv laster ned. |
| **Tydelig skille mellom offisielt og eget** | Status fra kommunen (grønn/rød) skilles klart fra brukerens egne merkinger (stiplet grønn) og fra ukjent (gul). |
| **Ingen gjetting** | Der kildene ikke sier noe, sier appen det («Arter ikke registrert», «Kommunen oppgir ikke hvilket grunneierlag …»). |
| **Kilder vises** | Alle data har kilde og lisens, samlet under «© Kilder». |

---

## 2. Arkitektur

```
Nettleser
├── index.html, app.js, style.css      Kart (Leaflet), infoboks, menyer
├── logg.js                            Fangstlogg, erfaringer, Min logg, backup
├── bilder.js                          Komprimering og lagring av bilder i OPFS
├── arter.js                           Fiskesilhuetter (inline SVG)
├── db.js  ──postMessage──▶ db-worker.js
│                            └── SQLite WASM (OPFS)  ← /data/seed.sql (vann)
├── sw.js                              Service worker (offline)
└── versjon.json                       Versjon/dato, skrives ved publisering

Byggeverktøy (Node, kjøres av utvikler)
├── scripts/hent-vann.mjs   Henter vann + arter, kobler mot kommunens lister → public/data/seed.sql
├── scripts/vendor-sqlite.mjs  Kopierer SQLite WASM til public/vendor
└── scripts/versjon.mjs     Skriver public/versjon.json
```

### Hvorfor ingen server?
Første versjon hadde en Cloudflare Worker med Hono-API og en D1-database. Den ble erstattet
fordi appen skulle virke helt uten nett og fordi brukerdata (fangster, bilder) ikke skal ligge
på en server. Cloudflare brukes nå bare til å servere statiske filer (`wrangler.jsonc`, kun
`assets`). D1-databasen `karmoy-fiskevann-db` finnes fortsatt i Cloudflare-kontoen, men brukes ikke.

### SQLite i nettleseren (OPFS)
- `@sqlite.org/sqlite-wasm` kjører i en egen Web Worker (`db-worker.js`) og lagrer i
  nettleserens Origin Private File System (OPFS).
- Lagring i prioritert rekkefølge: `opfs` → `opfs-sahpool` → minne (f.eks. privat vindu).
- `opfs` krever SharedArrayBuffer, og dermed headerne i `public/_headers`:
  `Cross-Origin-Opener-Policy: same-origin` og `Cross-Origin-Embedder-Policy: require-corp`.
- Kartverkets kartfliser lastes med `crossOrigin`, siden Kartverket sender CORS-header (kreves av COEP).
- Ingen byggesteg: bibliotekene (Leaflet, SQLite WASM, JSZip) ligger kopiert i `public/vendor/`.

### Tabeller
| Tabell | Innhold | Hvem skriver |
|---|---|---|
| `ferskvann` | Vann og tjern med status, sone, arter, salg, advarsel, adkomst | `seed.sql` (erstattes ved hver ny versjon) |
| `fangster` | Brukerens fangster (art, vekt, lengde, redskap, vær, GPS, bilde, notat) | Brukeren |
| `erfaringer` | Tips per vann (tittel, tekst, vindretning, bilde) | Brukeren |
| `egne_soner` | Brukerens egen merking «dette vannet hører til sone X» | Brukeren |
| `meta` | Dataversjon, sist endret, sist backup | Appen |

**Beskyttelse av brukerdata:** `seed.sql` dropper og lager bare `ferskvann` på nytt.
Workeren nekter å kjøre en `seed.sql` som nevner brukertabellene, og en feilet import
rulles tilbake slik at forrige vanndata beholdes og appen fortsatt virker.

### Bilder
- Komprimeres i nettleseren med canvas: maks 1200 px bredde, JPEG 80 % (typisk 150–250 kB).
- Lagres som egne filer i OPFS-mappa `/bilder`; databasen lagrer bare filnavnet.
- Skrives av workeren med `createSyncAccessHandle` (virker også i Safari).
- `<input type="file" accept="image/*">` uten `capture`, så mobilen tilbyr både kamera og galleri.

### Service worker (offline)
- App-filer: **nettet først** (ny versjon vises med en gang), lagret kopi uten nett eller etter 4 s.
- Kartfliser fra Kartverket: lagret først, maks 800 fliser, beholdes ved app-oppdateringer.
- `/data/seed.sql` går rett til nettet; uten nett bruker workeren data som allerede ligger i SQLite.
- Siden lastes på nytt én gang når en ny versjon tar over (ikke mens et skjema er åpent).

---

## 3. Vanndata – hvordan `seed.sql` lages

`npm run vann:hent` kjører `scripts/hent-vann.mjs`:

1. **Vann og tjern**
   - Prøver først OpenStreetMap via Overpass (gir omriss).
   - Faller tilbake til **Kartverkets stedsnavnregister (SSR)**: alle navngitte vann og tjern i
     kommune 1149, med offisielt punkt men uten omriss. Dette er kilden i dag, fordi Overpass
     ikke svarer fra byggemiljøet.
   - `--kilde osm|ssr|auto` velger kilde.
2. **Status fra kommunen** – konfigurasjonen øverst i skriptet:
   - `GODKJENTE_VANN`: de 43 fiskevannene fra kommunens fiskekart, med nummer, sone, art og adkomst.
   - `FORBUDSVANN`: 15 vann med fiskeforbud (3 vasspest, 12 uten oppgitt årsak).
   - `SALG_PER_SONE` / `UTSALG`: hvor man kjøper fiskekort.
   - Alle andre vann får status `ukjent_grunneier`.
3. **Kobling** – hver oppføring har et `punkt` (fra SSR, eller georeferert fra fiskekartet).
   Uten omriss må navnet ligne eller avstanden være under 150 m. Finnes vannet ikke, lages det
   fra konfigurasjonen. Doble SSR-oppføringer for samme vann fjernes.
4. **Arter fra GBIF** – fiskefunn fra GBIF kobles til vann når stedsnavnet nevner vannet, eller
   funnet ligger innen 250 m med god nøyaktighet. Slås sammen med fiskekartets arter; eldste og
   nyeste år og antall funn lagres per art. `--uten-gbif` slår det av.
5. Skriver `public/data/seed.sql` med en versjonslinje øverst. Appen importerer bare når den endres.

### Status og farger
| Status | Farge på kartet | Betydning |
|---|---|---|
| `fiskekort` | Grønn | Godkjent fiskevann i kommunens fiskekart – kjøp fiskekort |
| `forbud_vasspest` | Rød med «!» | Fiskeforbud, vasspest påvist |
| `forbud_drikkevann` | Rød med «!» | Fiskeforbud, drikkevannskilde (ingen i dag) |
| `forbud_annet` | Rød med «!» | «Fiske ikke tillatt» i fiskekartet, uten oppgitt årsak |
| `ukjent_grunneier` | Gul/grå | Ikke i fiskekartet – kontakt grunneier |
| egen merking | Stiplet grønn | Brukerens egen merking, ikke bekreftet av kommunen |

Rød er reservert for forbud.

### Fiskekortsoner, grunneierlag og salg
| Sone | Grunneierlag | Kjøpesteder |
|---|---|---|
| Vest-Karmøy | Vest-Karmøy grunneierlag | Vipps 629636, MX Sport Kopervik, Basen Redskaper AS |
| Øst-Karmøy | Aust-Karmøy grunneierlag | MX Sport Kopervik, Basen Redskaper AS |
| Avaldsnes | ikke oppgitt av kommunen | MX Sport Kopervik |
| Fastlandssiden og Fosen | Fastlandssiden og Fosen grunneierlag | Salar Sportsfiske |

Sonen for hvert av de 43 vannene er lest av fiskekortgrensene i kommunens fiskekart.
Nedre Buadalsvatn (nr. 24) ligger på grensen og er lagt i Øst-Karmøy. Stiklevatn Nord (nr. 17)
er en del av Stiklevatnet og hører til Vest-Karmøy, mens resten av vannet er Øst-Karmøy.

---

## 4. Brukergrensesnitt

- **Kart:** Kartverkets topografiske kart (Leaflet), markører farget etter status, «Min posisjon».
- **Bunnmeny:** «Kart» (tegnforklaring og «Vis mine fangstpunkt»), «Min logg», «Regler & kort».
- **Infoboks for et vann:** advarsel øverst ved forbud, «+ Logg fangst», faner
  «Info & fiskekort», «Erfaringer (n)», «Fangster (n)». Info-fanen viser arter med silhuetter,
  status, grunneierlag, Vipps/kjøpesteder, adkomst og knappene Veibeskrivelse, Norgeskart,
  «© Kilder» og Kommunens fiskekart.
- **Fiskesilhuetter:** egne tegninger (inline SVG) for ørret, røye, laks/sjøørret, gjedde, abbor,
  ål og karpe, pluss en generell fisk. Størrelse: gjedde og laks 100 %, middels arter 60 %,
  karpe 40 %. Under hver art: nyeste år med funn i GBIF, eller «Fiskekartet».
- **Regler & kort:** barn under 16 år, de fire sonene med grunneierlag og kjøpesteder,
  smittevern (vasspest), laks og sjøørret (fiskeravgift).
- **Min logg:** statistikk (antall fisk, totalvekt, antall vann, største fisk per art, beste vann),
  tidslinje med bilder, backup, varig lagring.
- **Backup-påminnelse:** rødt «!» på «Min logg» når loggen er endret etter siste backup.
- **Varig lagring:** knapp som ber nettleseren om ikke å slette dataene; viser svaret.
- **Versjon:** liten tekst under tittelen, f.eks. «v1.0.24 · oppdatert 20.11.2026».
- Språk: norsk bokmål. Lyst og mørkt tema følger telefonens innstilling.

---

## 5. Kilder og lisenser

| Hva | Kilde | Lisens |
|---|---|---|
| Kartgrunnlag | [Kartverket](https://www.kartverket.no/) – topografisk kart (cache.kartverket.no) | CC BY 4.0 |
| Vann og tjern (navn og punkt) | [Kartverkets stedsnavnregister (SSR)](https://www.kartverket.no/api-og-data/stedsnavndata), ws.geonorge.no | CC BY 4.0 |
| Omriss av vann (når tilgjengelig) | [OpenStreetMap-bidragsytere](https://www.openstreetmap.org/copyright) via Overpass | ODbL 1.0 |
| Fiskevann, soner, forbud, adkomst, arter | Karmøy kommune og Karmøy Jeger Fisker og Naturvernforening: [Tur- og fiskekart for Karmøy kommune](https://www.karmoy.kommune.no/_f/p1/i62e78360-4026-41be-8709-f2ca6d82222c/tur-og-fiskekart-for-karmoy-kommune.pdf) (2. opplag) | Kommunens publikasjon |
| Kjøpesteder, Vipps, forbudsvann med koordinater | Karmøy kommune: [Fritidsfiske](https://www.karmoy.kommune.no/innbygger/kultur-og-fritid/tur-og-friluftsliv/jeg-vil-ut-pa-tur/fritidsfiske/) | Kommunens nettside |
| Fiskearter (fiskefunn) | [GBIF.org](https://www.gbif.org/): NINA Vanndata fisk, Vannmiljø – artsforekomster, Artsobservasjoner, Norwegian freshwater lake fish inventory, Ims fish tag database, Biodiversity data from Miljolare.no | CC BY 4.0 |
| Fiskeregler | [NJFF – fiskeregler](https://www.njff.no/fiske/fiskeregler) | – |
| Kartbibliotek | [Leaflet](https://leafletjs.com/) 1.9 | BSD-2 |
| Database | [SQLite WASM](https://sqlite.org/wasm) 3.54.1 | Apache-2.0 |
| Zip (backup) | [JSZip](https://stuk.github.io/jszip/) 3.10.1 | MIT |

Kommunens fiskekart er fra 2012 (sist endret 2018), så regler og adkomst kan være utdatert.
Appen sier det der opplysningene vises.

---

## 6. Kjente begrensninger

- Vannene har ikke omriss så lenge dataene kommer fra SSR (Overpass svarer ikke fra byggemiljøet).
  Kjør `npm run vann:hent` fra en vanlig maskin for å prøve OpenStreetMap igjen.
- Arter er bare kjent for vann der fiskekartet eller GBIF har opplysninger (65 av 135 vann).
  GBIF-funn kan være gamle (1970–2025).
- Fangstloggen ligger bare i nettleseren på én enhet. Varig lagring avgjøres av nettleseren;
  backup er den sikre løsningen.
- Fangster og erfaringer kan slettes, men ikke redigeres.
- Grunneierlag for Avaldsnes er ikke oppgitt av kommunen.

---

## 7. Utvikling

```bash
npm ci                 # installer
npm run dev            # lokal server (wrangler dev) på http://localhost:8787
npm test               # tester for importskriptet
npm run vann:hent      # hent vann og arter på nytt → public/data/seed.sql
npm run deploy         # publiser til Cloudflare (skriver versjon.json først)
```

Versjonsnummer: `1.0.<antall commits>`; «+» betyr at det ble publisert med ucommitede endringer.
Endre fiskevann, forbud, soner eller kjøpesteder i konfigurasjonen øverst i
`scripts/hent-vann.mjs`, kjør `npm run vann:hent`, commit og publiser.
