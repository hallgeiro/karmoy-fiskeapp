# Redigere fangster og erfaringer

> **Status: PLANLAGT – 2026-11-20.** Ikke startet.

## I dag

Fangster og erfaringer kan legges inn og slettes, men ikke endres. En skrivefeil i vekt eller art
må rettes ved å slette og legge inn på nytt – og da forsvinner bildet hvis det ikke lastes opp igjen.

## Forslag

- «Rediger» på hvert kort i fangstlista og tidslinjen, som åpner samme skjema ferdig utfylt.
- Bildet beholdes hvis du ikke velger nytt; nytt bilde erstatter og sletter det gamle fra OPFS.
- GPS-posisjon kan beholdes, oppdateres eller fjernes.
- Endring skal kalle `merkEndret()` (backup-påminnelsen).

## Å passe på

- `UPDATE` med samme kolonner som skjemaet; ikke rør `opprettet`.
- Backupformatet trenger ingen endring.
