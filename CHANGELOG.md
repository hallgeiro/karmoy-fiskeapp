# Endringslogg

Nyeste øverst. Hver oppføring har dato og versjonen endringen kom i
(`1.0.<antall commits>`, vises under tittelen i appen). Regelen for nye
oppføringer står i [CLAUDE.md](CLAUDE.md).

- **2026.11.24** (v1.0.42):
  Fisketider er forenklet og penere. Stedet er nå alltid Karmøy, så stedssøk og «Min posisjon»
  er fjernet. Figuren bruker dempede natt- og dagfarger (blågrå natt, sand dag, støvet fiolett
  grålysning og skumring), og hvert lag har natt/dag som bakgrunn slik at du ser når på døgnet
  et vindu ligger. «Nå»-streken er oransje.

- **2026.11.24** (v1.0.40):
  Ny meny nederst: **Fisketider** – en huggtabell for i dag og de to neste dagene. For hver dag vises
  grålysning og skumring, lufttrykk (f.eks. «Faller 11:00–22:00 (−7 hPa)», fallende trykk er
  utheva), månefase og månens hoved- og biperioder. Trykk på en dag for å se «Dagens beste vinduer»
  (lys), døgnfiguren med trykk, kaldt vann og måne, og en strek for «nå». Stedet er Karmøy som standard; søk opp
  et annet sted i Norge eller bruk din posisjon. Under tabellen ligger en kort guide om
  vanntemperatur, vind og skydekke. Sol og måne regnes ut i appen og virker derfor uten nett;
  lufttrykk og temperatur hentes fra Open-Meteo og lagres i opptil tre dager. Over polarsirkelen
  vises midnattssol og mørketid i stedet for klokkeslett. «Kaldt vann» bygger på lufttemperaturen,
  siden Open-Meteo ikke oppgir vanntemperatur; månens betydning er svakere dokumentert enn
  lys og trykk, og er derfor tegnet diskret.

- **2026.11.24** (v1.0.37):
  Du kan nå redigere fangster og erfaringer. Trykk ✏️ på kortet (i fanene på vannet eller i
  «Min logg»), så åpnes skjemaet ferdig utfylt. Bildet beholdes hvis du ikke velger et nytt;
  et nytt bilde erstatter det gamle, og «Fjern bildet» tar det bort. Posisjonen kan beholdes,
  byttes med «Bruk min posisjon» eller fjernes. Registreringsdatoen røres ikke, og endringen
  teller som endring for backup-påminnelsen.

- **2026.11.24** (v1.0.36):
  Gjøremålslista er oppdatert: flytting av loggen til den nye adressen er avmerket som ikke
  nødvendig, siden appen bare var testet. Ingen endring i appen.

- **2026.11.24** (v1.0.33):
  Artsfilteret i tegnforklaringen er en nedtrekksmeny i stedet for en rad med knapper, så
  det tar mye mindre plass på mobil. Menyen viser «Alle» eller de valgte artene, og du kan
  krysse av flere arter om gangen. Menyen blir stående åpen mens du velger.

- **2026.11.24** (v1.0.32):
  Versjonsnummeret under tittelen viste «v1.0.1» etter automatisk publisering, fordi
  byggetjenesten bare henter siste commit. Versjonsskriptet henter nå hele historikken
  først, så nummeret stemmer igjen. `CLAUDE.md` beskriver nå arbeidsmåten: gren,
  pull request, sammenslåing på GitHub og automatisk publisering.

- **2026.11.24** (v1.0.31):
  Appen publiseres nå automatisk fra GitHub når `main` endres (Cloudflare Workers
  Builds), så det trengs ikke lenger en terminal for å legge ut ny versjon.
  Ingen endring i selve appen.

- **2026.11.24** (v1.0.29):
  Du kan filtrere kartet i tegnforklaringen under «Kart». Trykk på en rad
  (Fiskekort, Fiskeforbud, Din egen merking, Ukjent fiskerett) for å skjule eller vise de
  vannene. Under «Fiskearter» kan du velge én eller flere arter, så vises bare vann
  der arten er kjent; vann uten kjente arter skjules da. Filtrene kan kombineres. En prikk
  på «Kart»-knappen viser at et filter er på, og «Vis alle» nullstiller alt. Valget huskes
  på enheten.

- **2026.11.24** (v1.0.28):
  Ny gjøremålsliste i `plans/todo.md` med alt som gjenstår, samlet fra planene.
  Ingen endring i appen.

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
