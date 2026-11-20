// Bilder for fangstloggen: komprimeres i nettleseren og lagres som filer i
// OPFS-mappa /bilder. SQLite lagrer bare filnavnet.
import { lagreBildefil, slettBildefil } from "/db.js";

const MAKS_BREDDE = 1200;
const KVALITET = 0.8;

/** Skaler ned til maks 1200 px bredde og lag JPEG (80 %). Gir en Blob på typisk 150–250 kB. */
export async function komprimer(fil) {
	// createImageBitmap roterer etter EXIF-orientering (mobilbilder står riktig vei)
	const bilde = await createImageBitmap(fil, { imageOrientation: "from-image" });
	const skala = Math.min(1, MAKS_BREDDE / bilde.width);
	const w = Math.round(bilde.width * skala);
	const h = Math.round(bilde.height * skala);
	const offscreen = typeof OffscreenCanvas !== "undefined";
	const canvas = offscreen ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#fff"; // gjennomsiktige PNG-er får hvit bakgrunn i JPEG
	ctx.fillRect(0, 0, w, h);
	ctx.drawImage(bilde, 0, 0, w, h);
	bilde.close();
	if (offscreen) return canvas.convertToBlob({ type: "image/jpeg", quality: KVALITET });
	return new Promise((løs, avvis) =>
		canvas.toBlob((b) => (b ? løs(b) : avvis(new Error("Klarte ikke komprimere bildet"))), "image/jpeg", KVALITET),
	);
}

/** Komprimer og lagre. Gir filnavnet, f.eks. «fangst_1732019200000_ab12.jpg». */
export async function lagreBilde(fil, prefiks = "fangst") {
	const blob = await komprimer(fil);
	const navn = `${prefiks}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
	await lagreBildefil(navn, blob);
	return navn;
}

export const slettBilde = (navn) => (navn ? slettBildefil(navn) : Promise.resolve());

/** Les bildefila fra OPFS (null hvis den mangler). */
export async function hentBildefil(navn) {
	try {
		const mappe = await (await navigator.storage.getDirectory()).getDirectoryHandle("bilder");
		return await (await mappe.getFileHandle(navn)).getFile();
	} catch {
		return null;
	}
}

/**
 * Object-URL-er for visning. Hver visning (f.eks. et infoark) bruker sin egen
 * «gruppe»; frigi() kaller revokeObjectURL på alle URL-ene i gruppa.
 */
export function bildeGruppe() {
	const urler = new Set();
	return {
		async url(navn) {
			const fil = navn && (await hentBildefil(navn));
			if (!fil) return null;
			const u = URL.createObjectURL(fil);
			urler.add(u);
			return u;
		},
		/** Fyll alle <img data-bilde="filnavn"> inne i el. */
		async fyll(el) {
			await Promise.all(
				[...el.querySelectorAll("img[data-bilde]")].map(async (img) => {
					const u = await this.url(img.dataset.bilde);
					if (u) img.src = u;
					else img.replaceWith(Object.assign(document.createElement("span"), { className: "bilde-mangler", textContent: "Bildet finnes ikke lenger" }));
				}),
			);
		},
		frigi() {
			for (const u of urler) URL.revokeObjectURL(u);
			urler.clear();
		},
	};
}

/** Alle bildefiler i /bilder (for backup). */
export async function alleBilder() {
	const ut = [];
	try {
		const mappe = await (await navigator.storage.getDirectory()).getDirectoryHandle("bilder");
		for await (const [navn, h] of mappe.entries()) if (h.kind === "file") ut.push({ navn, fil: await h.getFile() });
	} catch {
		/* ingen bilder ennå */
	}
	return ut;
}
