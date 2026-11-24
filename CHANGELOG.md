# Endringslogg

Nyeste øverst. Hver oppføring har dato og versjonen endringen kom i
(`1.0.<antall commits>`, vises under tittelen i appen). Regelen for nye
oppføringer står i [CLAUDE.md](CLAUDE.md).

- **2026.11.24** (v1.0.27):
  Appen har fått enklere adresse: <https://karmoyfiske.hallgeirolsen.com>. Den gamle
  adressen (`karmoy-fiskeapp.karmoy-fiskeapp.workers.dev`) virker fortsatt. Merk at
  loggen ligger lagret per adresse i nettleseren: ta backup på den gamle adressen
  og gjenopprett den på den nye før du begynner å bruke den.

- **2026.11.20** (v1.0.26):
  Ny mappe `plans/` med én fil per planlagt forbedring og en statuslinje øverst:
  omriss fra OpenStreetMap, redigering av fangster og erfaringer, «Finn grunneier»,
  synlig kartkreditering og en samleliste med mindre ting. `DESIGN.md` har fått
  avsnitt om hvorfor valgene ble tatt (nettleser i stedet for server, SQLite i OPFS,
  bilder som filer, stedsnavnregisteret, nettet først i service workeren m.m.) og en
  del om det som er fjernet (serverversjonen med D1).

- **2026.11.20** (v1.0.25):
  Dokumentasjonen er delt etter mønster fra TreDeSpace: `README.md` sier hva
  appen er og hvordan man prøver den, `CLAUDE.md` samler reglene for videre
  utvikling («når du endrer X, gjør også Y» – endringslogg, vanndata, vern av
  brukerdata, offline-lista, kilder) og kodestilen, og denne endringsloggen er
  skrevet om fra én linje per commit til løpende tekst per dato og versjon.

- **2026.11.20** (v1.0.24):
  `DESIGN.md` beskriver appen, valgene, arkitekturen, hvordan vanndataene lages,
  og alle kilder med lisens. Endringsloggen ble lagt til.

- **2026.11.20** (v1.0.16–v1.0.23):
  Fiskearter vises på alle vann, også der det er fiskeforbud. Fire forbudsvann
  har gjedde i kommunens fiskekart, og fiskefunn fra GBIF (NINA Vanndata fisk,
  Vannmiljø, Artsobservasjoner m.fl.) legger til arter der kommunen ikke har
  opplysninger: 65 av 135 vann har nå kjente arter, mot 47 før. Under hver art
  står året for nyeste funn i GBIF, eller «Fiskekartet»; der ingen kilde vet
  noe, står det «Arter ikke registrert». Doble vann i stedsnavnregisteret er
  ryddet bort.

  «Min logg» har fått en knapp som ber nettleseren om varig lagring og viser
  svaret, og et rødt «!» på menyknappen når loggen er endret etter siste
  backup. Versjonsnummer og dato for siste oppdatering står i liten tekst under
  tittelen. Kildene er samlet under «© Kilder» i knapperaden i vann-infoboksen
  og nederst i «Regler & kort», med lenker og lisenser.

  Nye versjoner av appen vises med en gang: app-filene hentes fra nettet først
  (lagret kopi uten nett eller etter 4 sekunder), og siden lastes på nytt én
  gang når en ny versjon tar over. Før kunne telefonen vise forrige versjon til
  den var lastet på nytt to ganger. Kartfliser du har sett, beholdes ved
  oppdatering.

- **2026.11.20** (v1.0.11–v1.0.15):
  Fiskeartene vises som silhuetter – egne tegninger av ørret, røye,
  laks/sjøørret, gjedde, abbor, ål og karpe – i infoboksen, fangstlista og
  «Største fisk per art». Gjedde og laks tegnes størst, karpe minst.

  Grunneierlaget for hver fiskekortsone vises sammen med kjøpestedene.
  Kommunen oppgir ikke grunneierlag for Avaldsnes, og appen sier det.

  Du kan merke et gult vann som del av en fiskekortsone når du vet at det har
  samme regler, f.eks. etter avklaring med grunneierlaget. Merkingen vises
  stiplet grønt og «ikke bekreftet av kommunen», ligger bare på din enhet, kan
  fjernes og er med i backup.

- **2026.11.20** (v1.0.6–v1.0.10):
  Appen kjører nå helt i nettleseren: SQLite i nettleserens lagring (OPFS) i en
  egen Web Worker, uten server-API og uten database på server. Den virker uten
  nett.

  Kartet viser 137 vann og tjern fra Kartverkets stedsnavnregister, fordi
  OpenStreetMap-tjenesten (Overpass) ikke svarte fra byggemiljøet. De 43
  fiskevannene, sonene, artene og adkomsten er hentet fra kommunens tur- og
  fiskekart; vann som ikke fantes under samme navn, ble funnet ved å legge
  fiskekartet over Kartverkets kart. 15 forbudsvann og alle kjøpesteder med
  Vipps 629636 for Vest-Karmøy kommer fra kommunens nettside.

  Ny fiskedagbok: logg fangster med art, vekt, lengde, redskap, vær,
  GPS-posisjon, bilde og notat, og skriv erfaringer per vann. Infoboksen har
  fanene «Info & fiskekort», «Erfaringer» og «Fangster». «Min logg» viser
  statistikk og tidslinje med bilder. Bildene komprimeres til maks 1200 px og
  lagres i nettleseren. Backup lastes ned som en zip-fil og kan gjenopprettes.
  «Vis mine fangstpunkt» tegner fangster med posisjon på kartet.

  Ny bunnmeny med «Regler & fiskekort»: barn under 16, de fire sonene,
  smittevern (vasspest) og fiskeravgift for laks og sjøørret.

- **2026.11.20** (v1.0.1–v1.0.5):
  Første versjoner: fiskeplasser i sjøen, værmelding fra MET og fangstdagbok,
  deretter et fullskjermkart over ferskvann – som en Cloudflare Worker med
  API og D1-database. Erstattet av nettleser-appen i v1.0.6.
