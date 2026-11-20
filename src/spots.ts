/**
 * Fiskeplasser på Karmøy. Koordinatene er omtrentlige (rundt hundre meter)
 * og bør sjekkes på kartet før de brukes til noe viktig.
 */
export interface Spot {
	id: string;
	name: string;
	lat: number;
	lon: number;
	type: "molo" | "svaberg" | "strand" | "bru" | "havn";
	description: string;
	species: string[];
}

export const SPOTS: Spot[] = [
	{
		id: "skudeneshavn",
		name: "Skudeneshavn",
		lat: 59.1475,
		lon: 5.2615,
		type: "havn",
		description: "Moloer og kaier ved den gamle trehusbyen sør på øya. Lett tilgjengelig, fint for barn.",
		species: ["makrell", "sei", "lyr", "berggylt"],
	},
	{
		id: "sandve",
		name: "Sandve",
		lat: 59.172,
		lon: 5.196,
		type: "svaberg",
		description: "Svaberg og strand på vestsiden, åpent mot havet. Best i rolig vær.",
		species: ["sei", "torsk", "sjøørret", "berggylt"],
	},
	{
		id: "vedavagen",
		name: "Vedavågen",
		lat: 59.208,
		lon: 5.199,
		type: "havn",
		description: "Liten fiskerihavn på vestsiden med moloer på begge sider av innløpet.",
		species: ["makrell", "sei", "lyr", "torsk"],
	},
	{
		id: "ferkingstad",
		name: "Ferkingstad",
		lat: 59.226,
		lon: 5.188,
		type: "molo",
		description: "Molo og svaberg ved en værhard havn. Kan gi stor sei på høsten.",
		species: ["sei", "torsk", "lyr", "makrell"],
	},
	{
		id: "akrehamn",
		name: "Åkrehamn",
		lat: 59.262,
		lon: 5.187,
		type: "havn",
		description: "Den største havnen på vestsiden, med lange moloer. Populær makrellplass om sommeren.",
		species: ["makrell", "sei", "hyse", "torsk"],
	},
	{
		id: "kopervik",
		name: "Kopervik",
		lat: 59.283,
		lon: 5.307,
		type: "havn",
		description: "Kaier i sentrum mot Karmsundet. Skjermet når det blåser fra vest.",
		species: ["sei", "makrell", "torsk", "sjøørret"],
	},
	{
		id: "visnes",
		name: "Visnes",
		lat: 59.355,
		lon: 5.225,
		type: "svaberg",
		description: "Svaberg ved det gamle gruvesamfunnet nordvest på øya.",
		species: ["sei", "lyr", "berggylt", "torsk"],
	},
	{
		id: "karmsundbrua",
		name: "Karmsundbrua",
		lat: 59.369,
		lon: 5.291,
		type: "bru",
		description: "Sterk strøm i sundet under brua gir godt fiske, særlig når strømmen snur.",
		species: ["sei", "makrell", "torsk", "sjøørret"],
	},
];

export const SPECIES = [
	"makrell",
	"sei",
	"torsk",
	"lyr",
	"hyse",
	"berggylt",
	"sjøørret",
	"hvitting",
	"lysing",
	"annet",
] as const;

export function findSpot(id: string): Spot | undefined {
	return SPOTS.find((s) => s.id === id);
}
