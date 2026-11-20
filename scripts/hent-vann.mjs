#!/usr/bin/env node
/**
 * Henter alle navngitte ferskvann/innsjøer i Karmøy kommune (kommunenr. 1149)
 * fra OpenStreetMap via Overpass API og skriver public/data/seed.sql.
 *
 * Appen kjører kun i nettleseren: public/db-worker.js laster seed.sql inn i
 * SQLite (WASM, lagret i OPFS) når versjonslinja øverst i fila endrer seg.
 * Fila inneholder både skjema og data for tabellen `ferskvann`.
 *
 *   npm run vann:hent                         # hent fra Overpass, skriv seed.sql
 *   node scripts/hent-vann.mjs --lagre-rå osm.json   # lagre Overpass-svaret også
 *   node scripts/hent-vann.mjs --fra-fil osm.json    # bruk lagret svar (ingen nettverk)
 *   node scripts/hent-vann.mjs --ut annen.sql --med-unavngitte
 *
 * Alle vann får status `ukjent_grunneier`, unntatt de som står i
 * GODKJENTE_VANN (→ `fiskekort`) eller FORBUDSVANN (→ `forbud_*`) nedenfor.
 *
 * Kartdata © OpenStreetMap-bidragsytere, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 */

// ============================================================================
// KONFIGURASJON – rediger her
// ============================================================================

export const SONER = ["Vest-Karmøy", "Øst-Karmøy", "Avaldsnes", "Fastlandet/Fosen"];

/**
 * Utsalgssteder for fiskekort, fra kommunens side om fritidsfiske (KILDER.fritidsfiske).
 * `lenke` er valgfri: uten lenke viser appen en kartsøk-lenke (butikk) eller en
 * kopier-knapp (Vipps).
 */
export const UTSALG = {
	vippsVest: {
		type: "vipps",
		navn: "Vipps",
		nummer: "629636",
		mottaker: "Vest-Karmøy grunneierlag",
		info: "Skriv inn Vipps-nummeret i Vipps-appen, så ser du hva kortene koster.",
	},
	mxSportKopervik: {
		type: "butikk",
		navn: "MX Sport Kopervik",
		adresse: "Henrik Klausens gt. 2, 4250 Kopervik",
		telefon: ["52 85 12 88", "946 17 676"],
	},
	basenRedskaper: {
		type: "butikk",
		navn: "Basen Redskaper AS",
		adresse: "Kanalveien, 4280 Skudeneshavn",
		telefon: ["52 82 72 70"],
	},
	salarSportsfiske: {
		type: "butikk",
		navn: "Salar Sportsfiske",
		adresse: "Salhusvegen 163, 5538 Haugesund",
		telefon: ["906 51 829"],
	},
};

/** Kilder som vises i appen. */
export const KILDER = {
	fritidsfiske: "https://www.karmoy.kommune.no/innbygger/kultur-og-fritid/tur-og-friluftsliv/jeg-vil-ut-pa-tur/fritidsfiske/",
	fiskekart: "https://www.karmoy.kommune.no/_f/p1/i62e78360-4026-41be-8709-f2ca6d82222c/tur-og-fiskekart-for-karmoy-kommune.pdf",
};

/**
 * Hvor man kjøper fiskekort i hver sone (kommunens side om fritidsfiske).
 * Gjelder alle godkjente vann i sonen, med mindre vannet har egen `salg`.
 * Kommunen oppgir ikke priser: spør i butikken, eller se prisen i Vipps.
 */
export const SALG_PER_SONE = {
	"Vest-Karmøy": [UTSALG.vippsVest, UTSALG.mxSportKopervik, UTSALG.basenRedskaper],
	"Øst-Karmøy": [UTSALG.mxSportKopervik, UTSALG.basenRedskaper],
	Avaldsnes: [UTSALG.mxSportKopervik],
	"Fastlandet/Fosen": [UTSALG.salarSportsfiske],
};

/**
 * De 43 godkjente fiskevannene fra Karmøy kommunes fiskekart.
 *
 * Kilde: «Tur- og fiskekart for Karmøy kommune» (2. opplag, PDF fra
 * karmoy.kommune.no). Nummer, navn og adkomst er fra tabellen «Ferskvannsfiske».
 * Sone er lest av fiskekortgrensene på kartet; arter av fiskesymbolet
 * (rød = aure, grå = gjedde). Punktene er fra Kartverkets stedsnavnregister
 * (SSR), der noen vann har annen skrivemåte enn i fiskekartet; «≈» betyr
 * anslått ved å georeferere fiskekartet mot kjente vann (±50–100 m).
 *
 *   nr           nummeret på fiskekartet
 *   navn         navnet slik det står i fiskekartet
 *   sone         én av SONER
 *   punkt        [lat, lng] inne i/ved vannet – brukes til å finne riktig OSM-vann
 *                (tryggere enn navn, siden flere vann heter det samme)
 *   osm          valgfri OSM-id ('w123' / 'r456') – overstyrer punkt og navn
 *   salg         valgfri: overstyrer SALG_PER_SONE for dette vannet
 *   arter        valgfri: 'ørret, gjedde'
 *   adkomst      valgfri: parkering/adkomst
 *   beskrivelse  valgfri
 *
 * Skriptet varsler om vann det ikke finner, og om OSM-navnet avviker fra navnet her.
 */
export const GODKJENTE_VANN = [
	// --- Vest-Karmøy ---
	{ nr: 1, navn: "Litlavatn", sone: "Vest-Karmøy", punkt: [59.16159, 5.21348], arter: "ørret", adkomst: "Ta av ved Løkaberg og følg Mjølhusvegen (off. veg). Etter ca. 1,5 km er du ved Litlavatn." },
	{ nr: 2, navn: "Grødheimsvatn", sone: "Vest-Karmøy", punkt: [59.1637, 5.2182], arter: "ørret", adkomst: "Ta av til venstre fra RV 47 ved Kyrkjeleite og kjør ca. 500 m." },
	{ nr: 7, navn: "Nordre og Søra Rotavatn", sone: "Vest-Karmøy", punkt: [59.18434, 5.23262], arter: "ørret", adkomst: "Ligger ca. 1–1,5 km vest for Røyningsvatn. Ta av ved Løkaberg og kjør innover ca. 2,5 km i nordvestlig retning (priv. veg)." },
	{ nr: 8, navn: "Mjåvatn", sone: "Vest-Karmøy", punkt: [59.19527, 5.24312], arter: "ørret", adkomst: "Ta av ved Sandhåland og følg Mjåvatnevegen (off. veg) rett østover ca. 3,5 km til demning." },
	{ nr: 11, navn: "Indre Holmavatn", sone: "Vest-Karmøy", punkt: [59.20302, 5.24652], arter: "ørret, gjedde", adkomst: "Ca. 500 m øst for Sandvatnet ved Burmavegen (off. veg) tar du av til høyre. Følg vegen ca. 700 m." },
	{ nr: 12, navn: "Ytre Holmavatn", sone: "Vest-Karmøy", punkt: [59.2071, 5.23421], arter: "ørret, gjedde", adkomst: "Fra Ferkingstad følger du Burmavegen ca. 3 km til du kommer til bro. Sandvatn ligger nord for vegen og Ytre Holmavatn sør for vegen." },
	{ nr: 17, navn: "Stiklevatn Nord", sone: "Vest-Karmøy", punkt: [59.22729, 5.26893] /* ≈ georeferert fra fiskekartet */, arter: "ørret", adkomst: "Ca. 2 km vest for sørenden av Stiklevatn (demning) tar du av nordover og følger samme sti som «Karmøymarsjen» i ca. 1,5 km." },
	{ nr: 22, navn: "Tretjødnane", sone: "Vest-Karmøy", punkt: [59.22249, 5.23251] /* SSR «Tretjørnane» */, arter: "ørret", adkomst: "Ta av fra RV 47 øst for Ferkingstad havn og følg veg (priv. veg) østover ca. 500 m. Herfra følger du sti ca. 2 km i østlig retning." },
	{ nr: 23, navn: "Øvre Buadalsvatn", sone: "Vest-Karmøy", punkt: [59.23584, 5.27171], arter: "ørret", adkomst: "Ved Sør-Stokke tar du av mot vest og følger vegen (priv. veg) ca. 500 m. Deretter sti vestover ca. 2 km til S. Sålefjell og dreier SV ca. 1 km." },
	{ nr: 25, navn: "Vaulen", sone: "Vest-Karmøy", punkt: [59.25407, 5.25291], arter: "ørret", adkomst: "Ta av fra RV 47. Følg Grindhaugvegen 500 m øst. Følg Myrdalvegen ca. 1 km sørøstover til den deler seg. Ta av til venstre. Følg stien ca. 2 km." },
	{ nr: 26, navn: "Tistreidvatn", sone: "Vest-Karmøy", punkt: [59.26102, 5.25492] /* SSR «Tistreivatnet» */, arter: "ørret", adkomst: "Fra Veasletta (100 m øst for Veakrysset) følger du sti sørover ca. 1,5 km." },
	{ nr: 27, navn: "Aureidvatn", sone: "Vest-Karmøy", punkt: [59.26474, 5.24305] /* SSR «Aureivatnet» */, arter: "ørret", adkomst: "Fra Veasletta (100 m øst for Veakrysset) følger du sti sørover ca. 1 km." },
	{ nr: 28, navn: "Heiavatn", sone: "Vest-Karmøy", punkt: [59.27207, 5.227], arter: "gjedde", adkomst: "Ca. 1 km fra Veasletta i retning Åkrehamn på venstre side. Priv. veg vest og øst for vatnet." },
	{ nr: 29, navn: "Nedre Brekkevatn", sone: "Vest-Karmøy", punkt: [59.27292, 5.25941], arter: "ørret", adkomst: "Parkering på vest- og østsiden av Nedre Brekkevatn." },

	// --- Øst-Karmøy (Aust-Karmøy fiskekortområde) ---
	{ nr: 3, navn: "Almannamyr", sone: "Øst-Karmøy", punkt: [59.15748, 5.25703] /* SSR «Allmannamyra» */, arter: "ørret", adkomst: "Ta av fra RV 47 ved Pinsemenigheten Salem (bedehus). Parkering ved idrettshallen. Ca. 200 m spasertur." },
	{ nr: 4, navn: "Litlavatn", sone: "Øst-Karmøy", punkt: [59.16445, 5.25848], arter: "ørret", adkomst: "Ta av fra RV 47 ved Pinsemenigheten Salem (bedehus). Parkering ved idrettshallen. Fra Almannamyr er det ca. 1 km." },
	{ nr: 5, navn: "Ilsvatn", sone: "Øst-Karmøy", punkt: [59.17162, 5.24764], arter: "ørret", adkomst: "Ta av fra RV 47 ved Pinsemenigheten Salem (bedehus). Parkering ved idrettshallen. Ca. 2 km gange." },
	{ nr: 6, navn: "Røyningsvatn", sone: "Øst-Karmøy", punkt: [59.18114, 5.24974], arter: "ørret", adkomst: "Ta av fra RV 511 ved Vikevågen. Følg Hilleslandvegen fram til Hilleslandsvatnet. Så Sklevegen 200 m før du tar av til venstre. 2 km gange." },
	{ nr: 9, navn: "Dalsvatn", sone: "Øst-Karmøy", punkt: [59.19523, 5.28634], arter: "ørret", adkomst: "Du kan komme deg til Dalsvatn fra Burmavegen (off. veg). Fra sørenden av Stiklevatn er det ca. 1 km i sørlig retning." },
	{ nr: 10, navn: "Kjigavatn", sone: "Øst-Karmøy", punkt: [59.2, 5.2963], arter: "ørret", adkomst: "Ved Blikshavn tar du av vestover og følger Burmavegen (off. veg) ca. 1 km. Kjigavatn ligger like sør for vegen." },
	{ nr: 13, navn: "Omundtjørna", sone: "Øst-Karmøy", punkt: [59.20943, 5.30744], arter: "ørret", adkomst: "Ved Blikshavn tar du av vestover og følger Burmavegen (off. veg) ca. 600 m. Omundtjørna ligger ca. 700 m i nordlig retning. Du kan følge bekken." },
	{ nr: 14, navn: "Holmavatn", sone: "Øst-Karmøy", punkt: [59.21141, 5.29964], arter: "ørret", adkomst: "Ved Blikshavn tar du av vestover og følger Burmavegen ca. 2 km til sørenden av Stiklevatn (demning). Vannet ligger ca. 500 m i nordøstlig retning." },
	{ nr: 15, navn: "Tømmerviksvatn", sone: "Øst-Karmøy", punkt: [59.2151, 5.3046], arter: "ørret", adkomst: "Ta av ved Tømmervik og følg veien (priv. veg) sørover ca. 500 m. Herfra er det omtrent 500 m i sørvestlig retning dersom du følger bekken." },
	{ nr: 16, navn: "Stiklevatn", sone: "Øst-Karmøy", punkt: [59.21984, 5.27565], arter: "ørret", adkomst: "Ved Blikshavn tar du av vestover og følger Burmavegen ca. 2 km til sørenden av Stiklevatn (demning)." },
	{ nr: 18, navn: "Vestra Mjåvatn", sone: "Øst-Karmøy", punkt: [59.22947, 5.2831], arter: "ørret", adkomst: "Ta av ved Bakken (Bekkarvika) og følg veien (priv. veg) vestover ca. 500 m. Deretter til fots ca. 2 km vestover." },
	{ nr: 19, navn: "Mjåvatn", sone: "Øst-Karmøy", punkt: [59.22552, 5.29646], arter: "ørret", adkomst: "Ta av ved Bakken (Bekkarvika) og følg veien (priv. veg) vestover ca. 500 m. Deretter til fots ca. 1 km vestover." },
	{ nr: 20, navn: "Røyningsvatn", sone: "Øst-Karmøy", punkt: [59.22435, 5.30527], arter: "ørret", adkomst: "Ta av ved Bakken (Bekkarvika) og følg veien (priv. veg) vestover ca. 500 m. Deretter til fots ca. 500 m vestover langs sti." },
	{ nr: 21, navn: "Reiarsvatn", sone: "Øst-Karmøy", punkt: [59.23315, 5.30096], arter: "ørret", adkomst: "Ved Sør-Stokke tar du av mot vest og følger vegen ca. 500 m. Deretter følger du sti sørvestover ca. 1,5 km." },
	// Fiskekortgrensen går langs vestbredden – vannet ligger på Aust-siden
	{ nr: 24, navn: "Nedre Buadalsvatn", sone: "Øst-Karmøy", punkt: [59.24171, 5.26718], arter: "ørret", adkomst: "Nedre Buadalsvatn ligger ca. 200 m nordvest for Øvre Buadalsvatn." },

	// --- Avaldsnes ---
	{ nr: 30, navn: "Slettevatn", sone: "Avaldsnes", punkt: [59.2919, 5.26777] /* SSR «Slettvatnet» */, arter: "ørret", adkomst: "Ta av fra RV 47 på Bygnes og følg Sundvegen (priv. veg) ca. 1 km vestover. Deretter til høyre og følg Gamle Sundvegen ca. 500 m." },
	{ nr: 31, navn: "Stora Fotvatnet", sone: "Avaldsnes", punkt: [59.29499, 5.27676], arter: "ørret", adkomst: "Ta av fra RV 47 på Bygnes og følg Sundvegen (off. veg) ca. 500 m vestover. Ta av til høyre. Parkering på anviste P-plasser." },
	{ nr: 32, navn: "Rossavatnet", sone: "Avaldsnes", punkt: [59.29842, 5.2587], arter: "ørret", adkomst: "Ta av fra RV 47 på Bygnes og følg Sundvegen ca. 3 km vestover. Deretter til høyre og følg Gamle Sundvegen (off. veg) ca. 150 m." },
	{ nr: 33, navn: "Storestemmen", sone: "Avaldsnes", punkt: [59.30077, 5.23963], arter: "ørret", adkomst: "Ta av fra RV 47 på Bygnes og følg Sundvegen ca. 5 km vestover. Deretter til høyre og parker langs kommunal veg." },
	{ nr: 34, navn: "Gåsavatn", sone: "Avaldsnes", punkt: [59.31606, 5.24005], arter: "ørret", adkomst: "Fra sentrum av Kvalavåg følger du Kvalavågvegen ca. 500 m. Så tar du til høyre og følger Sundvegen (off. veg) ca. 1 km." },
	{ nr: 35, navn: "Grodvatnet", sone: "Avaldsnes", punkt: [59.33158, 5.23483], arter: "ørret", adkomst: "Ta av fra RV 47 og følg RV 158 (Helganesvegen) ca. 1,5 km. Ta av til venstre og følg Kvalavågvegen (off. veg) ca. 1,5 km." },

	// --- Fastlandssiden og Fosen ---
	{ nr: 36, navn: "Aksnesvatn", sone: "Fastlandet/Fosen", punkt: [59.3827, 5.35072], arter: "ørret", adkomst: "Ta av fra Spannavegen og følg Aksnesvegen noen få hundre meter. Parkering på anviste P-plasser." },
	{ nr: 37, navn: "Helgelandsvatn", sone: "Fastlandet/Fosen", punkt: [59.374, 5.3312], arter: "ørret", adkomst: "Ta av til høyre fra Norheimvegen og følg Hestmyrvegen noen få hundre meter. Flere parkeringsplasser ved idrettshall." },
	{ nr: 38, navn: "Vormedalsvatnet", sone: "Fastlandet/Fosen", punkt: [59.3581, 5.3339], arter: "ørret", adkomst: "Ta av fra Vormedalsvegen og følg Steinhaugvegen noen få hundre meter til skole-/idrettsanlegg." },
	{ nr: 39, navn: "Tuastadvatnet", sone: "Fastlandet/Fosen", punkt: [59.34444, 5.33944], arter: "ørret", adkomst: "Ta av fra Spannavegen og følg vegen ca. 150 m. Parkering like før grendahuset på høyre side." },
	{ nr: 40, navn: "Litlavatnet", sone: "Fastlandet/Fosen", punkt: [59.33569, 5.33709], arter: "ørret", adkomst: "Følg Snikvegen sørover fra Vormedal i ca. 2 km. Ta av til Gamle Tuastadvegen. Parkering ved Gamle Tuastadveg." },
	{ nr: 41, navn: "Øvre Helgelandsvatn", sone: "Fastlandet/Fosen", punkt: [59.30605, 5.35094] /* SSR «Øvre Helgalandsvatnet» */, arter: "ørret", adkomst: "Fra Fosnavegen kjører du vestover ca. 750 m." },
	{ nr: 42, navn: "Nedre Helgelandsvatn", sone: "Fastlandet/Fosen", punkt: [59.3016, 5.35002] /* SSR «Nedre Helgalandsvatnet» */, arter: "ørret", adkomst: "Fra Fosnavegen kjører du vestover ca. 750 m." },
	{ nr: 43, navn: "Tjolandsvatnet", sone: "Fastlandet/Fosen", punkt: [59.29188, 5.35602], arter: "ørret", adkomst: "Fra Fosnavegen kjører du vestover ca. 750 m." },
];

export const STANDARD_ADVARSEL = {
	forbud_vasspest:
		"Vasspest er påvist i dette vannet. Ikke fisk her, og ikke flytt båt, utstyr, vann eller planter til andre vassdrag – vasspest sprer seg lett med plantebiter.",
	forbud_drikkevann:
		"Dette vannet er drikkevannskilde. Fiske, bading og ferdsel med båt er ikke tillatt.",
	forbud_annet: "Fiske er ikke tillatt i dette vannet ifølge kommunens tur- og fiskekart.",
};

/**
 * Vann med fiskeforbud, fra symbolene «Fiske ikke tillatt» og «Vasspest» i
 * kommunens fiskekart. Kartet oppgir ikke årsak for de fleste – de har status
 * forbud_annet. Vet du at et vann er drikkevannskilde, endre til forbud_drikkevann.
 *
 *   navn, punkt, osm   som over
 *   status             'forbud_vasspest', 'forbud_drikkevann' eller 'forbud_annet'
 *   advarsel           valgfri: overstyrer STANDARD_ADVARSEL
 *   arter              valgfri: arter i vannet (grå fisk i fiskekartet = gjedde)
 *   sone               valgfri
 */
export const FORBUDSVANN = [
	// Navn og punkt fra kartet «Disse vannene er det fisking forbudt» på kommunens
	// side om fritidsfiske; samme 15 vann som i fiskekartet (PDF).
	// Vasspest – merket «Vasspest» av kommunen
	{ navn: "Fiskåvatnet", status: "forbud_vasspest", punkt: [59.33485, 5.26422] },
	{ navn: "Hamravatnet", status: "forbud_vasspest", punkt: [59.19772, 5.2627], arter: "gjedde" }, // «Homravatnet» i fiskekartet
	{ navn: "Hilleslandsvatnet", status: "forbud_vasspest", punkt: [59.18386, 5.27464], arter: "gjedde" },
	// Fiskeforbud uten oppgitt årsak
	{ navn: "Lysvatnet", status: "forbud_annet", punkt: [59.31104, 5.36301] },
	{ navn: "Melstokkevatnet", status: "forbud_annet", punkt: [59.25207, 5.29834] },
	{ navn: "Moksheimsvatnet", status: "forbud_annet", punkt: [59.36898, 5.32209] },
	{ navn: "Nordre Visnesvatn", status: "forbud_annet", punkt: [59.35392, 5.23364] },
	{ navn: "Oskreivatnet", status: "forbud_annet", punkt: [59.25427, 5.28101] }, // «Oskereidvatn» i fiskekartet
	{ navn: "Rabbavatnet", status: "forbud_annet", punkt: [59.35868, 5.35815] },
	{ navn: "Sandvatnet", status: "forbud_annet", punkt: [59.21386, 5.24532], arter: "gjedde" },
	{ navn: "Spannavatnet", status: "forbud_annet", punkt: [59.37997, 5.32766] },
	{ navn: "Steinsvatnet", status: "forbud_annet", punkt: [59.304, 5.3588] },
	{ navn: "Søre Brekkevatnet", status: "forbud_annet", punkt: [59.26298, 5.2625] }, // «Øvre Brekkevatn» i fiskekartet
	{ navn: "Tjøsvollvatnet", status: "forbud_annet", punkt: [59.26432, 5.19875], arter: "gjedde" },
	{ navn: "Visnesvatnet", status: "forbud_annet", punkt: [59.34539, 5.23347] },
];

// ============================================================================
// Overpass
// ============================================================================

const KOMMUNENR = "1149";

// Boks rundt kommunen gjør spørringen mye lettere for Overpass-serveren;
// kommunegrensen (area) avgjør fortsatt hva som er med.
const BOKS = "59.04,5.0,59.47,5.5";
export const OVERPASS_QUERY = `[out:json][timeout:180][bbox:${BOKS}];
area["boundary"="administrative"]["admin_level"="7"]["ref"="${KOMMUNENR}"]->.kommune;
(
  way["natural"="water"](area.kommune);
  relation["natural"="water"](area.kommune);
  way["landuse"="reservoir"](area.kommune);
  relation["landuse"="reservoir"](area.kommune);
);
out geom;`;

const OVERPASS_URLER = [
	globalThis.process?.env?.OVERPASS_URL,
	"https://overpass-api.de/api/interpreter",
	"https://overpass.kumi.systems/api/interpreter",
	"https://overpass.private.coffee/api/interpreter",
].filter(Boolean);

/** Vanntyper som ikke er innsjøer/tjern. */
const IKKE_INNSJO = new Set([
	"river", "stream", "canal", "ditch", "drain", "wastewater", "stream_pool", "moat", "lock",
	"fishpass", "harbour", "lagoon", "reflecting_pool", "fountain", "swimming_pool", "basin",
]);

async function hentOverpass() {
	let sisteFeil;
	for (const url of OVERPASS_URLER) {
		try {
			console.error(`Henter fra ${url} …`);
			const res = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "karmoy-fiskeapp-import/1.0" },
				body: new URLSearchParams({ data: OVERPASS_QUERY }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
			return await res.json();
		} catch (e) {
			sisteFeil = e;
			console.error(`  feilet: ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ""}`);
		}
	}
	throw new Error(`Ingen Overpass-server svarte. Siste feil: ${sisteFeil?.message}`);
}

// ============================================================================
// Reservekilde: Kartverkets stedsnavnregister (SSR)
// ============================================================================
// Alle navngitte vann og tjern i kommunen, med offisielt punkt men uten omriss.
// Brukes når Overpass ikke svarer (eller med --kilde ssr). Data © Kartverket, CC BY 4.0.

const SSR_URL = "https://ws.geonorge.no/stedsnavn/v1/navn";
const SSR_TYPER = new Set(["Vann", "Tjern", "Gruppe av vann", "Gruppe av tjern", "Del av vann"]);

async function hentSsr() {
	console.error(`Henter vann og tjern fra Kartverkets stedsnavnregister …`);
	const funnet = new Map();
	// API-et krever søkeord; søk på hver forbokstav
	for (const b of "abcdefghijklmnopqrstuvwxyzæøå") {
		for (let side = 1; side < 20; side++) {
			const url = `${SSR_URL}?sok=${encodeURIComponent(b + "*")}&knr=${KOMMUNENR}&utkoordsys=4258&treffPerSide=500&side=${side}`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`SSR svarte HTTP ${res.status}`);
			const navn = (await res.json()).navn ?? [];
			for (const x of navn) if (SSR_TYPER.has(x.navneobjekttype)) funnet.set(x.stedsnummer, x);
			if (navn.length < 500) break;
		}
	}
	return [...funnet.values()];
}

/** Gjør SSR-treff om til samme form som vannFraElement() gir (uten omriss). */
export function vannFraSsr(ssr) {
	return ssr.map((x) => ({
		id: `s${x.stedsnummer}`,
		navn: x.skrivemåte,
		lat: rund(x.representasjonspunkt.nord),
		lng: rund(x.representasjonspunkt.øst),
		areal_m2: null,
		geometri: null,
	}));
}

// ============================================================================
// Tilleggskilde for arter: GBIF (NINA Vanndata fisk, Vannmiljø, Artsobservasjoner m.fl.)
// ============================================================================
// Fiskefunn i og rundt kommunen. Et funn kobles til et vann når stedsnavnet nevner
// vannet (innen 3 km), eller når det ligger innen 250 m fra vannets punkt og har
// koordinatnøyaktighet på 250 m eller bedre. Rene sjøarter tas ikke med.
// Data: GBIF.org, CC BY 4.0 (datasettene er listet i seed.sql).

const GBIF = "https://api.gbif.org/v1";
export const GBIF_ARTER = {
	"Salmo trutta": "ørret",
	"Salvelinus alpinus": "røye",
	"Salmo salar": "laks",
	"Esox lucius": "gjedde",
	"Perca fluviatilis": "abbor",
	"Anguilla anguilla": "ål",
	"Cyprinus carpio": "karpe",
	"Carassius carassius": "karuss",
	"Tinca tinca": "suter",
	"Rutilus rutilus": "mort",
	"Phoxinus phoxinus": "ørekyt",
	"Oncorhynchus mykiss": "regnbueørret",
	"Gasterosteus aculeatus": "trepigget stingsild",
	"Pungitius pungitius": "nipigget stingsild",
};

async function hentGbif() {
	console.error("Henter fiskefunn fra GBIF …");
	const nøkler = {};
	for (const navn of Object.keys(GBIF_ARTER)) {
		const j = await (await fetch(`${GBIF}/species/match?name=${encodeURIComponent(navn)}`)).json();
		if (j.usageKey) nøkler[j.usageKey] = navn;
	}
	const q = `country=NO&decimalLatitude=59.04,59.47&decimalLongitude=5.0,5.5&hasCoordinate=true&hasGeospatialIssue=false&occurrenceStatus=PRESENT&${Object.keys(nøkler).map((k) => `taxonKey=${k}`).join("&")}`;
	const funn = [];
	for (let off = 0; off < 20000; off += 300) {
		const res = await fetch(`${GBIF}/occurrence/search?${q}&limit=300&offset=${off}`);
		if (!res.ok) throw new Error(`GBIF svarte HTTP ${res.status}`);
		const j = await res.json();
		for (const r of j.results) {
			const art = GBIF_ARTER[nøkler[r.speciesKey]] ?? GBIF_ARTER[r.species];
			if (!art) continue;
			funn.push({ art, lat: r.decimalLatitude, lng: r.decimalLongitude, usikkerhet: r.coordinateUncertaintyInMeters ?? null, lokalitet: r.locality ?? r.waterBody ?? null, år: r.year ?? null, datasett: r.datasetKey });
		}
		if (j.endOfRecords) break;
	}
	const datasett = {};
	for (const k of new Set(funn.map((f) => f.datasett))) {
		try {
			datasett[k] = (await (await fetch(`${GBIF}/dataset/${k}`)).json()).title ?? k;
		} catch {
			datasett[k] = k;
		}
	}
	return { funn, datasett };
}

/** Koble GBIF-funn til vann. Returnerer Map<vann-id, Set<art>> og hvilke datasett som ble brukt. */
export function gbifArterPerVann(funn, vann) {
	const perVann = new Map();
	const brukt = new Set();
	for (const f of funn) {
		const lok = løsStamme(String(f.lokalitet ?? "").split(",")[0].trim());
		let beste = null;
		for (const v of vann) {
			const d = avstandMeter([f.lat, f.lng], [v.lat, v.lng]);
			const navnTreff = lok.length >= 3 && lok === løsStamme(v.navn) && d < 3000;
			const nær = d <= 250 && (f.usikkerhet ?? Infinity) <= 250;
			if ((navnTreff || nær) && (!beste || d < beste.d)) beste = { v, d };
		}
		if (!beste) continue;
		if (!perVann.has(beste.v.id)) perVann.set(beste.v.id, new Set());
		perVann.get(beste.v.id).add(f.art);
		brukt.add(f.datasett);
	}
	return { perVann, brukt };
}

/** Slå GBIF-arter sammen med artene fra konfigurasjonen (fiskekartet). */
export function leggTilGbifArter(rader, perVann) {
	let nye = 0;
	for (const r of rader) {
		const g = perVann.get(r.id);
		if (!g) continue;
		const før = (r.arter ?? "").split(",").map((a) => a.trim()).filter(Boolean);
		const alle = [...new Set([...før, ...g])];
		if (alle.length > før.length) nye++;
		r.arter = alle.join(", ");
		r.arter_kilde = [før.length ? "fiskekart" : null, "gbif"].filter(Boolean).join(",");
	}
	for (const r of rader) if (r.arter && !r.arter_kilde) r.arter_kilde = "fiskekart";
	return nye;
}

// ============================================================================
// Geometri
// ============================================================================

const toLngLat = (pts) => pts.map((p) => [p.lon, p.lat]);
const samme = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Grovt, men godt nok for innsjøer: meter per grad ved breddegrad lat0. */
function meterPerGrad(lat0) {
	return [111320 * Math.cos((lat0 * Math.PI) / 180), 110540];
}

function signertAreal(ring, mx, my) {
	let s = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		s += (ring[j][0] * mx) * (ring[i][1] * my) - (ring[i][0] * mx) * (ring[j][1] * my);
	}
	return s / 2;
}

/** Sett sammen åpne way-biter (fra en relation) til lukkede ringer. */
export function settSammenRinger(biter) {
	const igjen = biter.filter((b) => b.length >= 2).map((b) => b.slice());
	const ringer = [];
	let åpne = 0;
	while (igjen.length) {
		let ring = igjen.shift();
		let fant = true;
		while (!samme(ring[0], ring[ring.length - 1]) && fant) {
			fant = false;
			const slutt = ring[ring.length - 1];
			for (let i = 0; i < igjen.length; i++) {
				const b = igjen[i];
				if (samme(b[0], slutt)) ring = ring.concat(b.slice(1));
				else if (samme(b[b.length - 1], slutt)) ring = ring.concat(b.slice(0, -1).reverse());
				else continue;
				igjen.splice(i, 1);
				fant = true;
				break;
			}
		}
		if (samme(ring[0], ring[ring.length - 1]) && ring.length >= 4) ringer.push(ring);
		else åpne++;
	}
	return { ringer, åpne };
}

export function punktIRing([x, y], ring) {
	let inne = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inne = !inne;
	}
	return inne;
}

/** Douglas–Peucker i meter. Beholder alltid første og siste punkt. */
export function forenkleLinje(pts, tolMeter, mx, my) {
	if (pts.length <= 2) return pts;
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack = [[0, pts.length - 1]];
	const tol2 = tolMeter * tolMeter;
	while (stack.length) {
		const [a, b] = stack.pop();
		const ax = pts[a][0] * mx, ay = pts[a][1] * my;
		const dx = pts[b][0] * mx - ax, dy = pts[b][1] * my - ay;
		const len2 = dx * dx + dy * dy;
		let maxD = -1, idx = -1;
		for (let i = a + 1; i < b; i++) {
			const px = pts[i][0] * mx - ax, py = pts[i][1] * my - ay;
			let d2;
			if (len2 === 0) d2 = px * px + py * py;
			else {
				const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
				const ex = px - t * dx, ey = py - t * dy;
				d2 = ex * ex + ey * ey;
			}
			if (d2 > maxD) [maxD, idx] = [d2, i];
		}
		if (maxD > tol2) {
			keep[idx] = 1;
			stack.push([a, idx], [idx, b]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}

function forenkleRing(ring, tol, mx, my) {
	// Del ringen i to så Douglas–Peucker har to ulike endepunkter
	const mid = Math.floor(ring.length / 2);
	const a = forenkleLinje(ring.slice(0, mid + 1), tol, mx, my);
	const b = forenkleLinje(ring.slice(mid), tol, mx, my);
	const r = a.concat(b.slice(1));
	return r.length >= 4 ? r : null;
}

const rund = (n) => Math.round(n * 1e5) / 1e5; // ~1 m

/**
 * Lag polygoner av et Overpass-element (out geom).
 * Returnerer [{ ytre: ring, indre: ring[] }] i [lng, lat], eller null.
 */
export function polygonerFraElement(el) {
	if (el.type === "way") {
		const ring = toLngLat(el.geometry ?? []);
		if (ring.length < 4 || !samme(ring[0], ring[ring.length - 1])) return null;
		return [{ ytre: ring, indre: [] }];
	}
	if (el.type === "relation") {
		const medlemmer = (el.members ?? []).filter((m) => m.type === "way" && m.geometry);
		const ytre = settSammenRinger(medlemmer.filter((m) => m.role !== "inner").map((m) => toLngLat(m.geometry))).ringer;
		const indre = settSammenRinger(medlemmer.filter((m) => m.role === "inner").map((m) => toLngLat(m.geometry))).ringer;
		if (!ytre.length) return null;
		const polys = ytre.map((r) => ({ ytre: r, indre: [] }));
		for (const r of indre) polys.find((p) => punktIRing(r[0], p.ytre))?.indre.push(r);
		return polys;
	}
	return null;
}

/** Punkt for markøren: tyngdepunkt hvis det ligger i vannet, ellers midt på bredeste tverrsnitt. */
export function merkepunkt(poly) {
	const { ytre, indre } = poly;
	const iVann = (p) => punktIRing(p, ytre) && !indre.some((r) => punktIRing(p, r));
	let cx = 0, cy = 0, a = 0;
	for (let i = 0, j = ytre.length - 1; i < ytre.length; j = i++) {
		const f = ytre[j][0] * ytre[i][1] - ytre[i][0] * ytre[j][1];
		cx += (ytre[j][0] + ytre[i][0]) * f;
		cy += (ytre[j][1] + ytre[i][1]) * f;
		a += f;
	}
	if (a !== 0) {
		const c = [cx / (3 * a), cy / (3 * a)];
		if (iVann(c)) return c;
	}
	const ys = ytre.map((p) => p[1]);
	const [ymin, ymax] = [Math.min(...ys), Math.max(...ys)];
	let best = null, bestW = -1;
	for (let k = 1; k < 20; k++) {
		const y = ymin + ((ymax - ymin) * k) / 20;
		const xs = [];
		for (const ring of [ytre, ...indre]) {
			for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
				const [xi, yi] = ring[i], [xj, yj] = ring[j];
				if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
			}
		}
		xs.sort((p, q) => p - q);
		for (let i = 0; i + 1 < xs.length; i += 2) {
			if (xs[i + 1] - xs[i] > bestW) [bestW, best] = [xs[i + 1] - xs[i], [(xs[i] + xs[i + 1]) / 2, y]];
		}
	}
	return best ?? ytre[0];
}

/** Bygg rad-data (uten status) fra ett Overpass-element. */
export function vannFraElement(el, { tolMeter = 4 } = {}) {
	const polys = polygonerFraElement(el);
	if (!polys) return null;
	const lat0 = polys[0].ytre[0][1];
	const [mx, my] = meterPerGrad(lat0);
	const arealAv = (p) => Math.abs(signertAreal(p.ytre, mx, my)) - p.indre.reduce((s, r) => s + Math.abs(signertAreal(r, mx, my)), 0);
	const areal = polys.reduce((s, p) => s + arealAv(p), 0);
	const størst = polys.reduce((a, b) => (arealAv(b) > arealAv(a) ? b : a));
	const [lng, lat] = merkepunkt(størst);

	// GeoJSON: ytre ring mot klokka, indre med klokka (RFC 7946)
	const orienter = (ring, mot) => ((signertAreal(ring, mx, my) > 0) === mot ? ring : ring.slice().reverse());
	const lag = (tol) => {
		const ps = [];
		for (const p of polys) {
			const ytre = forenkleRing(p.ytre, tol, mx, my);
			if (!ytre) continue;
			const indre = p.indre.map((r) => forenkleRing(r, tol, mx, my)).filter(Boolean);
			ps.push([orienter(ytre, true), ...indre.map((r) => orienter(r, false))].map((r) => r.map(([x, y]) => [rund(x), rund(y)])));
		}
		if (!ps.length) return null;
		return ps.length === 1 ? { type: "Polygon", coordinates: ps[0] } : { type: "MultiPolygon", coordinates: ps };
	};
	// D1 tåler maks 100 kB per SQL-setning – forenkle mer for svært store vann
	let tol = tolMeter, geometri = lag(tol);
	while (geometri && JSON.stringify(geometri).length > 80_000) geometri = lag((tol *= 2));

	return {
		id: `${el.type[0]}${el.id}`,
		navn: el.tags?.name?.trim() || null,
		lat: rund(lat),
		lng: rund(lng),
		areal_m2: Math.round(areal),
		geometri,
	};
}

/** Er elementet en innsjø/tjern/magasin (ikke elv, kanal, basseng …)? */
export function erInnsjo(el) {
	const t = el.tags ?? {};
	if (t.natural !== "water" && t.landuse !== "reservoir") return false;
	if (IKKE_INNSJO.has(t.water)) return false;
	if (t.salt === "yes") return false;
	return true;
}

// ============================================================================
// Kobling mot konfigurasjonen
// ============================================================================

export function normaliserNavn(navn) {
	return navn
		.normalize("NFC")
		.toLowerCase()
		.replace(/\(.*?\)/g, " ")
		.replace(/[\s\-–.]+/g, "");
}
/** «Stiklevatnet», «Stiklevatn» og «Stiklevannet» → «stikle». */
const navnestamme = (navn) => normaliserNavn(navn).replace(/(vatnet|vatna|vatn|vannet|vann)$/, "");

/** Løs stamme for å sammenligne navn: uten «øvre/nedre …» og «-vatnet/-vatn …». */
const løsStamme = (navn) =>
	navnestamme(navn.replace(/^(nordre|søre|søra|nedre|øvre|indre|indra|ytre|ytra|vestre|vestra|austre|store|stora|litle|litla)\s+/i, ""));

function iRing([x, y], ring) {
	return punktIRing([x, y], ring);
}
/** Ligger [lng, lat] inne i GeoJSON-polygonet (og ikke på ei øy)? */
export function iGeometri(p, geom) {
	if (!geom) return false;
	const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
	return polys.some(([ytre, ...hull]) => iRing(p, ytre) && !hull.some((h) => iRing(p, h)));
}
function avstandMeter([lat1, lng1], [lat2, lng2]) {
	const [mx, my] = meterPerGrad((lat1 + lat2) / 2);
	return Math.hypot((lng1 - lng2) * mx, (lat1 - lat2) * my);
}

/**
 * Finn OSM-vann for en konfig-oppføring: osm-id, ellers punkt (vannet punktet
 * ligger i, eller nærmeste innen 400 m), ellers navn.
 * Returnerer { treff: vann[], feil?, merknad? }.
 */
export function finnVann(oppf, vann) {
	if (oppf.osm) {
		const v = vann.find((x) => x.id === oppf.osm);
		return v ? { treff: [v] } : { treff: [], feil: `OSM-id ${oppf.osm} finnes ikke i datasettet` };
	}
	if (oppf.punkt) {
		const [lat, lng] = oppf.punkt;
		const inni = vann.filter((v) => iGeometri([lng, lat], v.geometri)).sort((a, b) => a.areal_m2 - b.areal_m2);
		let v = inni[0];
		if (!v) {
			const nærmest = vann
				.map((x) => ({ x, d: avstandMeter(oppf.punkt, [x.lat, x.lng]) }))
				.sort((a, b) => a.d - b.d)[0];
			// Uten omriss vet vi ikke om punktet er i vannet: krev samme navn, eller svært nær
			const sammeNavn = nærmest && løsStamme(nærmest.x.navn) === løsStamme(oppf.navn);
			if (nærmest && nærmest.d <= 400 && (sammeNavn || nærmest.d <= 150)) v = nærmest.x;
		}
		if (!v) return { treff: [], feil: `ingen vann i datasettet ved punktet ${lat}, ${lng}`, utenTreff: true };
		const merknad = løsStamme(v.navn) === løsStamme(oppf.navn) ? undefined : `koblet via punkt til «${v.navn}» (${v.id}) i datasettet`;
		return { treff: [v], merknad };
	}
	let treff = vann.filter((v) => normaliserNavn(v.navn) === normaliserNavn(oppf.navn));
	if (!treff.length) treff = vann.filter((v) => navnestamme(v.navn) === navnestamme(oppf.navn));
	if (!treff.length) return { treff, feil: "fant ikke vannet i OSM – sjekk navnet, eller oppgi punkt eller osm-id" };
	if (treff.length > 1)
		return { treff: [], feil: `navnet matcher ${treff.length} vann (${treff.map((v) => `${v.id} «${v.navn}»`).join(", ")}) – oppgi punkt eller osm-id` };
	return { treff };
}

const merke = (o) => (o.nr ? `nr. ${o.nr} «${o.navn}»` : `«${o.navn}»`);

/**
 * Sett status, sone, salg og advarsel på hvert vann.
 * Returnerer { rader, advarsler, merknader }.
 */
export function kobleStatus(vann, { godkjente = GODKJENTE_VANN, forbud = FORBUDSVANN, salgPerSone = SALG_PER_SONE } = {}) {
	const advarsler = [];
	const merknader = [];
	const utenSalg = new Set();
	const rader = new Map(
		vann.map((v) => [
			v.id,
			{ ...v, status: "ukjent_grunneier", sone: null, salg: null, advarsel: null, arter: null, beskrivelse: null, kartnr: null, adkomst: null },
		]),
	);

	// I nummer-rekkefølge, så det laveste nummeret bestemmer sonen hvis to peker på samme vann
	for (const g of [...godkjente].sort((a, b) => (a.nr ?? 1e9) - (b.nr ?? 1e9))) {
		if (!SONER.includes(g.sone)) {
			advarsler.push(`Godkjent ${merke(g)}: ukjent sone «${g.sone}». Gyldige: ${SONER.join(", ")}`);
			continue;
		}
		const { treff, feil, merknad, utenTreff } = finnVann(g, vann);
		if (utenTreff) treff.push(opprettFraKonfig(g, rader, merknader));
		else if (feil) {
			advarsler.push(`Godkjent ${merke(g)}: ${feil}`);
			continue;
		}
		if (merknad) merknader.push(`Godkjent ${merke(g)}: ${merknad}`);
		const r = rader.get(treff[0].id);
		const nrTekst = g.nr ? String(g.nr) : null;
		if (r.status === "fiskekort") {
			// Samme OSM-vann som en tidligere oppføring (f.eks. to deler av ett vann)
			merknader.push(`Godkjent ${merke(g)}: samme OSM-vann som nr. ${r.kartnr} – slått sammen`);
			r.kartnr = [r.kartnr, nrTekst].filter(Boolean).join(", ");
			if (g.adkomst) r.adkomst = [r.adkomst, `${g.navn}: ${g.adkomst}`].filter(Boolean).join(" ");
			if (g.sone !== r.sone)
				r.beskrivelse = [r.beskrivelse, `${g.navn} (nr. ${g.nr}) hører til fiskekortområdet ${g.sone}.`].filter(Boolean).join(" ");
			continue;
		}
		Object.assign(r, {
			status: "fiskekort",
			sone: g.sone,
			salg: g.salg ?? salgPerSone[g.sone] ?? [],
			arter: g.arter ?? null,
			beskrivelse: g.beskrivelse ?? null,
			kartnr: nrTekst,
			adkomst: g.adkomst ?? null,
		});
		if (!r.salg.length) utenSalg.add(g.sone);
	}
	for (const sone of utenSalg) merknader.push(`Ingen salgsinfo for sone ${sone} i SALG_PER_SONE – appen viser de lokale utsalgsstedene`);

	for (const f of forbud) {
		if (!STANDARD_ADVARSEL[f.status]) {
			advarsler.push(`Forbud ${merke(f)}: ugyldig status «${f.status}» (${Object.keys(STANDARD_ADVARSEL).join(" / ")})`);
			continue;
		}
		const { treff, feil, merknad, utenTreff } = finnVann(f, vann);
		if (utenTreff) treff.push(opprettFraKonfig(f, rader, merknader));
		else if (feil) {
			advarsler.push(`Forbud ${merke(f)}: ${feil}`);
			continue;
		}
		if (merknad) merknader.push(`Forbud ${merke(f)}: ${merknad}`);
		const r = rader.get(treff[0].id);
		if (r.status === "fiskekort") advarsler.push(`«${r.navn}» står både som godkjent og med forbud – forbudet gjelder`);
		Object.assign(r, {
			status: f.status,
			sone: f.sone ?? r.sone,
			salg: null,
			arter: f.arter ?? r.arter,
			advarsel: f.advarsel ?? STANDARD_ADVARSEL[f.status],
		});
	}
	// Samme vann registrert to ganger (f.eks. «Helgelandsvatnet» og «Øvre Helgalandsvatnet»
	// i SSR): fjern ukjent-markører som ligger like ved et fiskekort- eller forbudsvann
	const kjente = [...rader.values()].filter((r) => r.status !== "ukjent_grunneier");
	for (const r of [...rader.values()]) {
		if (r.status !== "ukjent_grunneier" || r.geometri) continue;
		// Like nær og lignende navn (samme tre første bokstaver i stammen) – ellers er det trolig et annet tjern
		const nær = kjente.find(
			(k) => {
				const d = avstandMeter([r.lat, r.lng], [k.lat, k.lng]);
				return (d <= 150 && løsStamme(r.navn).slice(0, 3) === løsStamme(k.navn).slice(0, 3)) || (d <= 400 && navnestamme(r.navn) === navnestamme(k.navn)); // helt samme navn, f.eks. to «Tuastadvatnet»
			},
		);
		if (nær) {
			rader.delete(r.id);
			merknader.push(`«${r.navn}» (${r.id}) fjernet – ligger ${Math.round(avstandMeter([r.lat, r.lng], [nær.lat, nær.lng]))} m fra «${nær.navn}»`);
		}
	}
	return { rader: [...rader.values()], advarsler, merknader };
}

/** Vannet finnes ikke i datasettet: lag det fra konfigurasjonen (punkt, uten omriss). */
function opprettFraKonfig(o, rader, merknader) {
	const slug = o.navn.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	const v = { id: `k${o.nr ?? ""}-${slug}`, navn: o.navn, lat: o.punkt[0], lng: o.punkt[1], areal_m2: null, geometri: null };
	rader.set(v.id, { ...v, status: "ukjent_grunneier", sone: null, salg: null, advarsel: null, arter: null, beskrivelse: null, kartnr: null, adkomst: null });
	merknader.push(`${merke(o)}: finnes ikke i datasettet – lagt inn fra konfigurasjonen (${o.punkt.join(", ")})`);
	return v;
}

// ============================================================================
// SQL
// ============================================================================

export function sqlVerdi(v) {
	if (v === null || v === undefined) return "NULL";
	if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
	if (typeof v === "object") v = JSON.stringify(v);
	return `'${String(v).replace(/'/g, "''").replace(/[\r\n]+/g, " ")}'`;
}

/** Skjema. Tabellen er avledet data og lages på nytt ved hver import. */
export const SKJEMA = `DROP TABLE IF EXISTS ferskvann;
CREATE TABLE ferskvann (
	id          TEXT PRIMARY KEY,  -- OSM-id: 'w123' (way) eller 'r456' (relation)
	navn        TEXT NOT NULL,
	status      TEXT NOT NULL DEFAULT 'ukjent_grunneier'
	            CHECK (status IN ('fiskekort', 'ukjent_grunneier', 'forbud_vasspest', 'forbud_drikkevann', 'forbud_annet')),
	sone        TEXT CHECK (sone IS NULL OR sone IN ('Vest-Karmøy', 'Øst-Karmøy', 'Avaldsnes', 'Fastlandet/Fosen')),
	lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),    -- markørpunkt inne i vannet
	lng         REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
	areal_m2    REAL,
	geometri    TEXT,  -- GeoJSON Polygon/MultiPolygon (forenklet)
	salg        TEXT,  -- JSON: [{ "type": "vipps"|"butikk", "navn", "nummer"?, "mottaker"?, "info"?, "adresse"?, "telefon"?: [], "lenke"? }]
	advarsel    TEXT,  -- vises øverst i infoboksen for forbudsvann
	arter       TEXT,  -- kommaseparert, f.eks. 'ørret, røye'
	beskrivelse TEXT,
	arter_kilde TEXT,  -- 'fiskekart', 'gbif' eller 'fiskekart,gbif'
	kartnr      TEXT,  -- nummer i kommunens fiskekart, f.eks. '16' eller '16, 17'
	adkomst     TEXT,  -- parkering/adkomst fra fiskekartet
	CHECK (status <> 'fiskekort' OR sone IS NOT NULL),
	CHECK (status NOT LIKE 'forbud_%' OR advarsel IS NOT NULL)
);
CREATE INDEX idx_ferskvann_status ON ferskvann (status);`;

const KOLONNER = ["id", "navn", "status", "sone", "lat", "lng", "areal_m2", "geometri", "salg", "advarsel", "arter", "arter_kilde", "beskrivelse", "kartnr", "adkomst"];

/** Kort, stabil hash (FNV-1a) – brukes som versjon av datasettet. */
export function hash(tekst) {
	let h = 0x811c9dc5;
	for (let i = 0; i < tekst.length; i++) h = Math.imul(h ^ tekst.charCodeAt(i), 0x01000193) >>> 0;
	return h.toString(16).padStart(8, "0");
}

/**
 * Lag seed.sql. Første linje er «-- versjon: <hash>»; db-worker.js importerer
 * fila på nytt bare når den endrer seg.
 */
export function lagSeedSql(rader, { hentet = new Date(), kilde = "osm", gbifDatasett = [] } = {}) {
	const antall = (s) => rader.filter((r) => r.status === s).length;
	const kropp = [
		SKJEMA,
		...[...rader]
			.sort((a, b) => a.navn.localeCompare(b.navn, "nb") || a.id.localeCompare(b.id))
			.map((r) => `INSERT INTO ferskvann (${KOLONNER.join(", ")}) VALUES (${KOLONNER.map((k) => sqlVerdi(r[k])).join(", ")});`),
	].join("\n");
	return (
		[
			`-- versjon: ${hash(kropp)}`,
			"-- GENERERT av scripts/hent-vann.mjs – ikke rediger for hånd.",
			"-- Endre konfigurasjonen i skriptet og kjør `npm run vann:hent` på nytt.",
			"--",
			kilde === "ssr"
				? `-- Vann og tjern i Karmøy kommune (${KOMMUNENR}) fra Kartverkets stedsnavnregister (SSR), hentet ${hentet.toISOString().slice(0, 10)}.`
				: `-- Ferskvann i Karmøy kommune (${KOMMUNENR}) fra OpenStreetMap, data per ${hentet.toISOString().slice(0, 10)}.`,
			kilde === "ssr"
				? "-- Stedsnavn © Kartverket, CC BY 4.0. Bare punkt, ikke omriss. Status fra Karmøy kommunes fiskekart og nettside."
				: "-- Kartdata © OpenStreetMap-bidragsytere, ODbL 1.0.",
			...(gbifDatasett.length
				? ["-- Arter: kommunens fiskekart + fiskefunn fra GBIF.org (CC BY 4.0):", ...gbifDatasett.map((d) => `--   ${d}`)]
				: []),
			`-- ${rader.length} vann: ${antall("fiskekort")} fiskekort, ${antall("forbud_vasspest")} forbud (vasspest), ` +
				`${antall("forbud_drikkevann")} forbud (drikkevann), ${antall("forbud_annet")} forbud (annet), ${antall("ukjent_grunneier")} ukjent grunneier.`,
			kropp,
		].join("\n") + "\n"
	);
}

// ============================================================================
// Hovedprogram
// ============================================================================

/** Koble ferdige vann (f.eks. fra SSR) mot konfigurasjonen. */
export function behandleVann(vann, koble = {}) {
	return { ...kobleStatus(vann, koble), utenNavn: 0, ugyldig: 0 };
}

export function behandle(overpass, { medUnavngitte = false, ...koble } = {}) {
	const els = overpass.elements ?? [];
	// Way som også er ytre medlem av en vann-relation skal ikke telle dobbelt
	const iRelasjon = new Set(
		els.filter((e) => e.type === "relation" && erInnsjo(e)).flatMap((e) => (e.members ?? []).filter((m) => m.type === "way").map((m) => m.ref)),
	);
	const vann = [];
	let utenNavn = 0, ugyldig = 0;
	for (const el of els) {
		if (!erInnsjo(el) || (el.type === "way" && iRelasjon.has(el.id))) continue;
		const v = vannFraElement(el);
		if (!v?.geometri) {
			ugyldig++;
			continue;
		}
		if (!v.navn) {
			utenNavn++;
			if (!medUnavngitte) continue;
			v.navn = "Navnløst vann";
		}
		vann.push(v);
	}
	return { ...kobleStatus(vann, koble), utenNavn, ugyldig };
}

function argVerdi(args, navn) {
	const i = args.indexOf(navn);
	return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const args = process.argv.slice(2);
	const rot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
	const ut = path.resolve(argVerdi(args, "--ut") ?? path.join(rot, "public", "data", "seed.sql"));
	await fs.mkdir(path.dirname(ut), { recursive: true });
	const fraFil = argVerdi(args, "--fra-fil");
	const lagreRå = argVerdi(args, "--lagre-rå");

	// --kilde osm | ssr | auto (standard: prøv OpenStreetMap, bruk Kartverket hvis Overpass ikke svarer)
	const kildeValg = argVerdi(args, "--kilde") ?? "auto";
	let resultat, kilde, hentet;
	if (kildeValg !== "ssr") {
		try {
			const overpass = fraFil ? JSON.parse(await fs.readFile(fraFil, "utf8")) : await hentOverpass();
			if (lagreRå) await fs.writeFile(lagreRå, JSON.stringify(overpass));
			if (!overpass.elements?.length) throw new Error("Overpass ga ingen vann. Finnes kommunegrensen (ref=1149, admin_level=7) i OSM?");
			resultat = behandle(overpass, { medUnavngitte: args.includes("--med-unavngitte") });
			kilde = "osm";
			hentet = new Date(overpass.osm3s?.timestamp_osm_base ?? Date.now());
		} catch (e) {
			if (kildeValg === "osm") throw e;
			console.error(`\nOpenStreetMap feilet (${e.message}).\nBruker Kartverkets stedsnavnregister i stedet – vannene får punkt, men ikke omriss.\n`);
		}
	}
	if (!resultat) {
		const lagret = argVerdi(args, "--lagre-ssr");
		const ssr = await hentSsr();
		if (lagret) await fs.writeFile(lagret, JSON.stringify(ssr));
		resultat = behandleVann(vannFraSsr(ssr));
		kilde = "ssr";
		hentet = new Date();
	}
	const { rader, advarsler, merknader, utenNavn, ugyldig } = resultat;

	// Arter fra GBIF (slås sammen med fiskekartet). Feiler GBIF, brukes bare fiskekartet.
	let gbifDatasett = [];
	if (!args.includes("--uten-gbif")) {
		try {
			const { funn, datasett } = await hentGbif();
			const { perVann, brukt } = gbifArterPerVann(funn, rader);
			const nye = leggTilGbifArter(rader, perVann);
			gbifDatasett = [...brukt].map((k) => datasett[k]).sort();
			console.error(`GBIF: ${funn.length} fiskefunn, koblet til ${perVann.size} vann (${nye} fikk nye arter).`);
		} catch (e) {
			console.error(`GBIF feilet (${e.message}) – bruker bare artene fra fiskekartet.`);
		}
	}
	for (const r of rader) if (r.arter && !r.arter_kilde) r.arter_kilde = "fiskekart";
	await fs.writeFile(ut, lagSeedSql(rader, { hentet, kilde, gbifDatasett }));

	const antall = (s) => rader.filter((r) => r.status === s).length;
	console.error(`\nSkrev ${rader.length} vann (${kilde === "ssr" ? "Kartverket SSR" : "OpenStreetMap"}) til ${path.relative(process.cwd(), ut)}`);
	console.error(`  fiskekort: ${antall("fiskekort")} av ${GODKJENTE_VANN.length} i GODKJENTE_VANN`);
	console.error(`  forbud: ${antall("forbud_vasspest") + antall("forbud_drikkevann") + antall("forbud_annet")} av ${FORBUDSVANN.length} i FORBUDSVANN`);
	console.error(`  ukjent grunneier: ${antall("ukjent_grunneier")}`);
	console.error(`  hoppet over: ${utenNavn} uten navn${args.includes("--med-unavngitte") ? " (tatt med)" : ""}, ${ugyldig} uten gyldig polygon`);
	if (merknader.length) {
		console.error(`\n${merknader.length} merknad(er) – sjekk at koblingen stemmer:`);
		for (const m of merknader) console.error(`  · ${m}`);
	}
	if (advarsler.length) {
		console.error(`\n${advarsler.length} advarsel(er):`);
		for (const a of advarsler) console.error(`  ⚠ ${a}`);
		process.exitCode = 2;
	}
}

const erHovedprogram = typeof process !== "undefined" && process.argv?.[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (erHovedprogram) {
	main().catch((e) => {
		console.error(`Feil: ${e.message}`);
		process.exit(1);
	});
}
