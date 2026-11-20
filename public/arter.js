// Enkle silhuetter (sett fra siden, hodet til venstre) for fiskeartene på Karmøy.
// Egne tegninger som inline SVG – ingen eksterne bilder, virker offline.
// viewBox 0 0 120 48. Kroppen bruker currentColor; detaljer (øye, prikker,
// striper) tegnes lyse oppå.

const LYS = 'fill="#fff" fill-opacity=".55"';

// Laksefisk-kropp (ørret, røye, laks): spoleformet, fettfinne, kløftet hale
const laksefisk = ({ hale = 10, prikker = "" } = {}) => `
	<path d="M4 26 C10 16 26 12 46 12 C62 12 76 15 88 20 L100 22 L112 ${hale} C113 18 112 30 112 ${48 - hale} L100 28 L88 30 C76 35 60 38 44 37 C26 36 10 33 4 26 Z"/>
	<path d="M48 13 L56 3 L64 4 L66 13 Z"/>
	<path d="M80 17 L84 12 L87 18 Z"/>
	<path d="M56 36 L61 44 L67 36 Z"/>
	<path d="M72 34 L77 42 L83 32 Z"/>
	<path d="M24 30 L31 39 L35 31 Z" ${LYS}/>
	<circle cx="14" cy="23" r="2.2" fill="#fff"/>
	${prikker}`;

const SILHUETT = {
	ørret: laksefisk({
		prikker: [[30, 20], [40, 17], [52, 20], [62, 17], [70, 22], [46, 26], [58, 27], [36, 25], [76, 18]]
			.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" ${LYS}/>`)
			.join(""),
	}),
	røye: `${laksefisk({
		prikker: [[34, 22], [46, 19], [58, 23], [70, 20], [52, 29], [40, 28]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" ${LYS}/>`).join(""),
	})}
		<path d="M56 36 L61 44 L58 36 Z M72 34 L77 42 L74 34 Z" fill="#fff"/>`,
	laks: laksefisk({ hale: 6, prikker: [[50, 18], [60, 16], [70, 19]].map(([x, y]) => `<path d="M${x} ${y} l2 1.5 l-2 1.5 l-2 -1.5 z" ${LYS}/>`).join("") }),
	gjedde: `
		<path d="M2 24 L14 21 C24 18 40 16 60 16 C76 16 88 18 98 21 L104 22 L116 12 C117 20 117 28 116 36 L104 27 L96 29 C84 32 70 33 56 33 C38 33 22 31 12 28 L2 26 Z"/>
		<path d="M80 17 L87 8 L95 10 L98 21 Z"/>
		<path d="M80 31 L87 40 L95 38 L97 29 Z"/>
		<path d="M54 33 L58 40 L63 33 Z"/>
		<path d="M24 29 L30 36 L33 29 Z" ${LYS}/>
		<circle cx="17" cy="22" r="2" fill="#fff"/>
		${[[34, 21], [44, 24], [54, 20], [64, 25], [72, 21], [40, 28], [60, 29]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="1.3" ${LYS}/>`).join("")}`,
	abbor: `
		<path d="M6 28 C10 16 26 8 46 8 C62 8 76 13 86 20 L96 23 L110 10 C112 20 112 34 110 42 L96 31 L86 33 C74 41 58 44 42 44 C24 44 10 38 6 28 Z"/>
		<path d="M32 10 L34 1 L38 8 L41 0 L45 8 L48 0 L52 8 L55 1 L58 9 L61 4 L63 11 Z"/>
		<path d="M67 13 L73 5 L81 8 L84 18 Z"/>
		<path d="M70 40 L76 47 L82 37 Z"/>
		<path d="M38 43 L43 48 L49 43 Z"/>
		${[36, 48, 60, 72].map((x) => `<path d="M${x} 11 q3 16 0 31 l-4 0 q3 -15 0 -31 z" fill="#fff" fill-opacity=".28"/>`).join("")}
		<path d="M24 31 L31 39 L34 31 Z" ${LYS}/>
		<circle cx="17" cy="24" r="2.6" fill="#fff"/>`,
	ål: `
		<path d="M2 24 C10 18 20 18 30 22 C42 27 54 28 66 24 C78 20 90 19 102 21 C108 22 114 23 118 24 C114 28 108 29 102 28 C90 27 78 28 66 31 C54 34 42 33 30 29 C20 26 10 28 2 26 Z"/>
		<path d="M14 25 L19 29 L20 24 Z" ${LYS}/>
		<circle cx="7" cy="23.5" r="1.4" fill="#fff"/>`,
	fisk: `
		<path d="M6 26 C12 15 28 11 48 11 C64 11 78 15 90 21 L100 23 L112 12 C113 20 113 30 112 38 L100 28 L90 30 C78 36 62 39 46 38 C28 37 12 34 6 26 Z"/>
		<path d="M46 12 L54 4 L64 6 L66 13 Z"/>
		<path d="M60 36 L65 43 L71 35 Z"/>
		<path d="M26 30 L32 38 L36 31 Z" ${LYS}/>
		<circle cx="16" cy="23" r="2.2" fill="#fff"/>`,
};

/** Farge per art – mellomtoner som synes både i lyst og mørkt tema. */
const FARGE = { ørret: "#8a7340", røye: "#b0563a", laks: "#6d7f8f", gjedde: "#5f7d3a", abbor: "#6f7f2a", ål: "#8a7a5c", fisk: "#4f6f86" };

const ALIAS = { aure: "ørret", "sjøørret": "laks", "sjøaure": "laks", "regnbueørret": "ørret", "røyr": "røye", "ål": "ål", "al": "ål" };

/** Hvilken silhuett passer arten? Ukjente arter får en generell fisk. */
export function silhuettNøkkel(art) {
	const n = String(art ?? "").trim().toLowerCase();
	if (SILHUETT[n]) return n;
	if (ALIAS[n]) return ALIAS[n];
	for (const k of Object.keys(SILHUETT)) if (n.includes(k)) return k;
	return "fisk";
}

/** SVG-silhuett for arten. størrelse = bredde i px (høyden blir 40 %). */
export function artSvg(art, størrelse = 96) {
	const k = silhuettNøkkel(art);
	return `<svg class="art-svg" viewBox="0 0 120 48" width="${størrelse}" height="${Math.round(størrelse * 0.4)}" fill="${FARGE[k]}" role="img" aria-label="${k === "fisk" ? "Fisk" : k}"><g>${SILHUETT[k]}</g></svg>`;
}
