# Endringslogg

Alle endringer i Karmøy Fiskevann. Nyeste øverst. Versjonsnummeret er `1.0.<antall commits>`
og vises øverst i appen, under tittelen. Tidspunkt er i UTC.

## 2026-11-20

### 1.0.24 – Dokumentasjon
- La til `DESIGN.md` (beskrivelse av appen, valg, arkitektur og kilder) og denne endringsloggen.

### 1.0.23 – 11:24 – «© Kilder» i infoboksen
- Kildeknappen er flyttet fra kartet til knapperaden i vann-infoboksen, ved siden av
  Veibeskrivelse og Norgeskart. Også nederst i «Regler & kort».

### 1.0.22 – 11:22 – Bare nyeste årstall
- Under hver art vises bare året for nyeste funn i GBIF. Hele perioden og antall funn ligger i verktøytipset.

### 1.0.21 – 11:14 – Årstall for GBIF-funn og versjonsnummer
- Eldste og nyeste år og antall funn lagres per art og vann.
- Versjonsnummer og dato for siste oppdatering vises under tittelen og i «© Kilder».

### 1.0.20 – 11:06 – Kildeknapp
- Kildeteksten i kartet ble erstattet av knappen «© Kilder» med alle kilder og lisenser.

### 1.0.19 – 11:05 – Varig lagring og backup-påminnelse
- Knapp i «Min logg» som ber nettleseren om varig lagring og viser svaret.
- Rødt «!» på «Min logg» når loggen er endret etter siste backup.

### 1.0.18 – 10:39 – Fiskearter fra GBIF
- Fiskefunn fra GBIF (NINA Vanndata fisk, Vannmiljø, Artsobservasjoner m.fl.) slås sammen med
  fiskekartets arter. 65 av 135 vann har nå kjente arter (før 47).
- Kilde for artene vises under silhuettene. Doble vann i stedsnavnregisteret ryddet bort.

### 1.0.17 – 10:34 – Arter på alle vann
- «Arter i vannet» vises på alle vann, også forbudsvann. Fire forbudsvann fikk gjedde fra fiskekartet.
- «Arter ikke registrert» der kildene ikke har opplysninger.

### 1.0.16 – 10:23 – Raskere oppdateringer
- Service workeren henter app-filer fra nettet først, så nye versjoner vises med en gang.
- Siden lastes på nytt automatisk når en ny versjon tar over. Kartfliser beholdes ved oppdatering.

### 1.0.15 – 10:19 – Størrelser på silhuetter
- Middels arter 60 %, karpe 40 %.

### 1.0.14 – 10:18 – Relativ størrelse og karpe
- Gjedde og laks størst, karpe minst. Egen silhuett for karpe.

### 1.0.13 – 10:17 – Fiskesilhuetter
- Egne silhuetter for ørret, røye, laks/sjøørret, gjedde, abbor og ål i infoboksen, fangstlista
  og «Største fisk per art».

### 1.0.12 – 10:13 – Egen sonemerking
- Brukeren kan merke et ukjent vann som del av en fiskekortsone. Vises stiplet grønt og
  «ikke bekreftet av kommunen». Kan fjernes, og er med i backup.

### 1.0.11 – 10:06 – Grunneierlag
- Grunneierlaget for hver fiskekortsone vises i infoboksen og i «Regler & kort».

### 1.0.10 – 10:01 – Vann fra Kartverket
- Importen henter vann og tjern fra Kartverkets stedsnavnregister når Overpass ikke svarer.
- De siste fiskevannene funnet ved å georeferere kommunens fiskekart.
- Kartet fikk 137 vann (43 fiskevann, 15 forbud, 79 ukjent).

### 1.0.9 – 09:37 – Fiskedagbok
- Fangstlogg med art, vekt, lengde, redskap, vær, GPS-posisjon, bilde og notat.
- Erfaringer per vann. Faner i infoboksen. «Min logg» med statistikk og tidslinje.
- Bilder komprimeres og lagres i OPFS. Backup til og gjenoppretting fra .zip.
- «Vis mine fangstpunkt» på kartet.

### 1.0.8 – 09:14 – Vipps og kjøpesteder
- Vipps 629636 for Vest-Karmøy og kjøpesteder med adresse og telefon for alle soner.
- Forbudslista oppdatert fra kommunens nettside.

### 1.0.7 – 09:10 – Kommunens fiskekart
- De 43 fiskevannene med sone, arter og adkomst, og 15 forbudsvann, fra kommunens fiskekart.

### 1.0.6 – 09:00 – Appen kjører i nettleseren
- SQLite WASM i OPFS i egen Web Worker; server-API og D1 fjernet.
- Importskript for vann, «Regler & fiskekort»-panel, bunnmeny, COOP/COEP-headere.

### 1.0.5 – 08:36 – Fiskevann-tabell som migrasjon
- Tabellen for fiskevann flyttet inn i en D1-migrasjon.

### 1.0.4 – 08:34 – D1-database
- D1-databasen `karmoy-fiskevann-db` opprettet og koblet til.

### 1.0.3 – 07:33 – Ferskvann-PWA
- Fiskevann-tabell, Hono-API og fullskjermkart.

### 1.0.2 – 07:26 – Vær og database
- Test av værdata fra MET; D1-databasen omdøpt.

### 1.0.1 – 07:11 – Første versjon
- Fiskeplasser, vær og fangstdagbok (Cloudflare Worker med D1).
