import { describe, expect, test } from "vitest";

import {
	factPassage,
	isThin,
	joinNotes,
	mergedFacts,
	needsPageFacts,
	notesList,
	PAGE_FACTS_RETRY_MS,
	splitNotes,
	verifyElevation,
	verifyNote,
	verifyNotes,
	verifyProducer,
	verifyRegion,
	verifyVariety,
} from "./lotFacts";

describe("notes", () => {
	test("a descriptor clause becomes a list, whatever the roaster's separator", () => {
		// Fixtures from the 2026-09-15 audit (D3, D4, D5).
		expect(splitNotes("peach, melon, and red tea")).toEqual([
			"peach",
			"melon",
			"red tea",
		]);
		expect(
			splitNotes("Cherry Cola - Dried Fig - Brown Sugar - Cocoa Nib")
		).toEqual(["Cherry Cola", "Dried Fig", "Brown Sugar", "Cocoa Nib"]);
		expect(splitNotes("Prunes • Fig Danish • Nutmeg")).toEqual([
			"Prunes",
			"Fig Danish",
			"Nutmeg",
		]);
		expect(splitNotes("Caramel + Stone Fruit")).toEqual([
			"Caramel",
			"Stone Fruit",
		]);
		expect(splitNotes("bittersweet chocolate and graham cracker")).toEqual([
			"bittersweet chocolate",
			"graham cracker",
		]);
	});

	test("a swallowed clause drops out instead of becoming a note", () => {
		// Passenger "Necessary Dark Roast" as the old regex stored it.
		expect(
			splitNotes(
				"bittersweet chocolate and graham cracker, this classic Dark Roast tastes great on its own or with the addition"
			)
		).toEqual(["bittersweet chocolate", "graham cracker"]);
		expect(verifyNote("this classic Dark Roast tastes great")).toBeNull();
	});

	test("lead-ins, articles and trailing punctuation are not part of a note", () => {
		expect(verifyNote("Notes of Cherry")).toBe("Cherry");
		expect(verifyNote("a molasses-like sweetness")).toBe(
			"molasses-like sweetness"
		);
		expect(verifyNote("stewed blueberries.")).toBe("stewed blueberries");
		expect(verifyNote("")).toBeNull();
		expect(verifyNote("🌑")).toBeNull();
	});

	test("lists dedupe case-insensitively and cap at eight", () => {
		expect(verifyNotes(["Cherry", "cherry", "Cocoa"])).toEqual([
			"Cherry",
			"Cocoa",
		]);
		expect(splitNotes("a, b, c, d, e, f, g, h, i, j").length).toBe(8);
	});

	test("reads accept the pre-migration string and the list alike", () => {
		expect(notesList()).toEqual([]);
		expect(notesList("peach, melon")).toEqual(["peach", "melon"]);
		expect(notesList(["peach"])).toEqual(["peach"]);
		expect(joinNotes(["peach", "melon"])).toBe("peach, melon");
		expect(joinNotes()).toBeNull();
		expect(joinNotes([])).toBeNull();
	});
});

describe("field shapes", () => {
	test("elevation is a number with a unit", () => {
		// Determinism runs, audit §4.
		expect(verifyElevation("1800 MASL")).toBe("1800 MASL");
		expect(verifyElevation("1,600 - 1,800 masl")).toBe("1,600 - 1,800 masl");
		expect(verifyElevation("1500-1730masl")).toBe("1500-1730masl");
		expect(verifyElevation("1600 - 1700 m")).toBe("1600 - 1700 m");
		expect(verifyElevation("1900-2200m")).toBe("1900-2200m");
		expect(verifyElevation("Not specified")).toBeNull();
		expect(verifyElevation("high")).toBeNull();
		expect(verifyElevation("2100")).toBeNull();
	});

	test("variety is a short name or list, not a sentence", () => {
		expect(verifyVariety("Heirloom")).toBe("Heirloom");
		expect(verifyVariety("SL28, SL34, Ruiru 11")).toBe("SL28, SL34, Ruiru 11");
		expect(verifyVariety("74110 & 74158")).toBe("74110 & 74158");
		expect(
			verifyVariety("A mix of local landrace varieties grown by the family")
		).toBeNull();
		expect(verifyVariety("Not specified.")).toBeNull();
		expect(verifyVariety("Blend")).toBeNull();
	});

	test("region is place-shaped and a few words long", () => {
		expect(verifyRegion("Chinacla, La Paz")).toBe("Chinacla, La Paz");
		expect(verifyRegion("Gedeb")).toBe("Gedeb");
		expect(verifyRegion("the highlands north of the capital city")).toBeNull();
		expect(verifyRegion("1800m")).toBeNull();
	});

	test("producer is a name, not prose", () => {
		expect(verifyProducer("Wilfredo Ule Vargas")).toBe("Wilfredo Ule Vargas");
		expect(verifyProducer("Iyenga FCS")).toBe("Iyenga FCS");
		// Sey, both determinism runs.
		expect(
			verifyProducer(
				"a blend of harvests from a small group of producers in San Agustín, Huila"
			)
		).toBeNull();
		expect(
			verifyProducer("A small group of producers in San Agustín, Huila")
		).toBeNull();
		expect(verifyProducer("Grown by Hazel Arias.")).toBe(
			"Grown by Hazel Arias"
		);
	});
});

describe("merge", () => {
	const page = {
		elevation: "1800 MASL",
		process: "Natural",
		tastingNotes: ["Blackberry", "Cocoa"],
		variety: "SL28",
	};

	test("feed facts win, page facts fill the gaps", () => {
		expect(
			mergedFacts({ origin: "Kenya", pageFacts: page, process: "Washed" })
		).toEqual({
			elevation: "1800 MASL",
			notes: ["Blackberry", "Cocoa"],
			origin: "Kenya",
			process: "Washed",
			producer: null,
			region: null,
			roastLevel: null,
			variety: "SL28",
		});
		expect(
			mergedFacts({ pageFacts: page, roasterNotes: ["Peach"] }).notes
		).toEqual(["Peach"]);
		expect(mergedFacts({}).notes).toEqual([]);
	});

	test("the fact passage is one labelled line in a fixed order", () => {
		expect(
			factPassage(
				mergedFacts({ origin: "Kenya", pageFacts: page, process: "Washed" })
			)
		).toBe(
			"Origin: Kenya. Process: Washed. Variety: SL28. Elevation: 1800 MASL. Tasting notes: Blackberry, Cocoa."
		);
		expect(factPassage(mergedFacts({}))).toBeNull();
	});

	test("a lot is thin until process, variety and notes are all known", () => {
		expect(isThin({ process: "Washed" })).toBe(true);
		expect(
			isThin({ process: "Washed", roasterNotes: ["Peach"], variety: "SL28" })
		).toBe(false);
		expect(isThin({ pageFacts: page })).toBe(false);
	});

	test("a look asks the page once, then not again inside the retry window", () => {
		const now = 1_000_000_000;
		expect(needsPageFacts({ process: "Washed" }, now)).toBe(true);
		expect(needsPageFacts({ copyFetchedAt: now - 1000 }, now)).toBe(false);
		expect(
			needsPageFacts({ copyFetchedAt: now - PAGE_FACTS_RETRY_MS - 1 }, now)
		).toBe(true);
		// Settled lots never ask, however thin the feed.
		expect(needsPageFacts({ pageFacts: { process: "Natural" } }, now)).toBe(
			false
		);
		expect(
			needsPageFacts(
				{ process: "Washed", roasterNotes: ["Peach"], variety: "SL28" },
				now
			)
		).toBe(false);
	});
});
