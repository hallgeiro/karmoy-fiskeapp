# Fisketider (huggtabell)

> **Status: FERDIG (v1.0.47) – 2026-11-24.** Egen knapp i bunnmenyen: tabell for i dag og de to
> neste dagene, «Dagens beste vinduer» og en døgnfigur med trykk, vind, skyer, kaldt vann og måne.

## Hva det er

Et panel («Fisketider») som viser, for Karmøy (59,27 N, 5,28 Ø), når på døgnet det kan være best å
fiske. Bygget på tommelfingerregler fra fiskere, ikke målte sammenhenger – appen sier det i
guiden og ved månelaget.

| Del | Innhold |
|---|---|
| Dagens beste vinduer | Ett bånd: natt, grålysning (−45/+65 min rundt soloppgang), dag, skumring (−65/+45 min rundt solnedgang), «nå»-strek |
| Tabell (3 dager) | Grålysning, skumring, lufttrykk (f.eks. «Faller 11:00–22:00 (−7 hPa)»), vær (vind og skyer i dagslys), månefase, månens hoved- og biperioder |
| Døgnfigur | Lag for trykk, vind, skyer, kaldt vann (døgnsnitt < 5 °C → 11:00–14:30) og måne |
| Guide | «Slik bruker du tabellen»: lys, trykk, vanntemperatur, vind, skydekke, måne |

## Filer

- `public/astro.js` – sol og måne regnet lokalt (forenklede Meeus-/Astronomy Answers-formler, samme tilnærming som SunCalc, MIT). Kontrollert mot SunCalcs testverdier. Tidssone og sommertid (23/25-timersdøgn) via `Intl`.
- `public/huggtabell.js` – ren logikk uten DOM: regler som navngitte konstanter, `byggDag`, `byggUke`, trykk-, vind- og skyregler.
- `public/fisketider.js` – visning, henting fra Open-Meteo, bufring i `localStorage`.
- `test/astro.spec.mjs`, `test/huggtabell.spec.mjs` – 26 tester.
- Berørt: `index.html` (panel, nav-knapp, kilder), `app.js` (åpne/lukke), `sw.js` (`SHELL_FILES`), `style.css` (seksjonen «Fisketider»).

## Valg og begrunnelser

- **Egen astronomi i stedet for `suncalc`:** appen har ingen byggesteg. Samme formler, kontrollert mot SunCalc.
- **Vanlig JS i stedet for React/Tailwind:** passer resten av appen.
- **Fast sted (Karmøy):** stedssøk og GPS ble laget først, men fjernet på eierens ønske.
- **3 dager i stedet for 7:** eierens ønske, gjør tabellen mindre.
- **Lufttemperatur som stedfortreder for vanntemperatur:** Open-Meteo har ikke innsjødata. Teksten sier «trolig kaldt».
- **Kaldt vann = midt på dagen kan *også* være bra**, i tillegg til grålysning og skumring (ikke i stedet for).
- **Offline:** sol og måne virker uten nett; varselet bufres i opptil 3 døgn (`fisketider-varsel`). Dager som varselet ikke dekker, viser «–» (ikke «stabilt»).
- **Polare forhold:** midnattssol og mørketid vises som tekst, uten grålysning og skumring.
- **Farger:** fra appens palett (marineblått, grønt, ockra). Rødt er reservert for fiskeforbud. «Nå»-streken er oransje.
- **Vind og skydekke – norske kilder** (Alvestad, Jakt & Fiske, Klikk, Hooked, Fiskeogjakt): litt vind er nesten alltid bra, pålandsvind samler næring, nordavind omtales ofte som ugunstig (men også som myte), overskyet gir mindre var fisk. Vindretning vises, men vurderes ikke. Grensene 3–8 m/s (gunstig) og ≥ 10 m/s (kraftig) er vår egen tolkning, siden kildene ikke oppgir tall.
- **Lufttrykk:** kildene spriker. Værskifte er bra for ørret og gjedde, abbor liker stabilt vær. Teksten sier det.

## Åpent

- Open-Meteo-svaret (feltnavn `wind_speed_10m`, `wind_direction_10m`, `cloud_cover`) er ikke verifisert live fra byggemiljøet (ingen nettilgang). Sjekk i nettleseren at vind og skyer vises.
- Vanntemperatur og vannets farge (klart/brunt) er ukjent for appen; begge påvirker hvilke regler som passer.
- Mulig senere: vurdere vind per vann (hvilken bredd som får pålandsvind), skille mellom arter.
