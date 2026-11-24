# Finn grunneier

> **Status: PLANLAGT – venter på avklaring – 2026-11-20.** Krever ny nettverkstilgang
> (Geonorges eiendomskart) og en sjekk av hvordan lenker til Kartverkets eiendomsoppslag ser ut.

## Bakgrunn

For de gule vannene må man spørre grunneier, men appen sier ikke hvem det er.

- **Gårds- og bruksnummer** kan hentes fra Kartverkets åpne eiendomskart (matrikkelen via
  Geonorge): hvilke eiendommer som grenser til vannet. Et vann er ofte delt mellom flere eiendommer.
- **Navn på eier** er offentlig, men bare ved oppslag én og én eiendom (f.eks.
  seeiendom.kartverket.no). Kartverkets API for eierdata krever avtale.
- **Personvern:** eiernavn for hele kommunen skal ikke samles i appen – det blir en
  registerbehandling av personopplysninger (GDPR). En lenke til det offentlige oppslaget er uproblematisk.

## Forslag

Knappen «Finn grunneier» på gule vann: vis gårds- og bruksnumrene rundt vannet med lenke til
Kartverkets oppslag for hver eiendom. Eiernavn lagres ikke. Pek også på grunneierlagene, som ofte
forvalter fiskeretten.

## Gjenstår før start

- Godkjenne nettverkstilgang til Geonorges eiendomstjeneste.
- Finne riktig lenkeformat til Kartverkets eiendomsoppslag (ikke gjette).
