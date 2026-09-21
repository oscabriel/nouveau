// The flavor words a roaster writes as tasting notes, for over-proposing
// note candidates from a product page (ADR-0010, amended 2026-09-21). The
// page read asks Jev one Noul per candidate, so the list can be generous:
// a wrong candidate costs one question in a request that already carries
// two hundred. What it leaves out are the words every description uses
// that are not notes on their own (sweet, clean, rich, bright, balanced),
// which would spend a Noul on every page and never store. Spellings agree
// with tasting.ts's wheel where the wheel has one. Pure, no Convex imports.

export const FLAVOR_TERMS: readonly string[] = [
	// fruit
	"blueberry",
	"strawberry",
	"raspberry",
	"blackberry",
	"cherry",
	"black cherry",
	"sour cherry",
	"cherry cola",
	"plum",
	"red plum",
	"peach",
	"apricot",
	"nectarine",
	"mango",
	"papaya",
	"pineapple",
	"lychee",
	"grape",
	"red grape",
	"white grape",
	"concord grape",
	"muscat grape",
	"apple",
	"red apple",
	"green apple",
	"pear",
	"orange",
	"blood orange",
	"mandarin",
	"mandarin orange",
	"tangerine",
	"clementine",
	"lemon",
	"lime",
	"grapefruit",
	"pomelo",
	"yuzu",
	"bergamot",
	"passion fruit",
	"passionfruit",
	"guava",
	"kiwi",
	"melon",
	"watermelon",
	"cantaloupe",
	"honeydew",
	"coconut",
	"banana",
	"tamarind",
	"cranberry",
	"currant",
	"blackcurrant",
	"black currant",
	"red currant",
	"fig",
	"raisin",
	"prune",
	"dried fruit",
	"stone fruit",
	"tropical fruit",
	"red fruit",
	"dark fruit",
	"citrus",
	"berry",
	"berries",
	"pluot",
	"gooseberry",
	"elderberry",
	"pomegranate",
	"quince",
	"persimmon",
	"starfruit",
	"jackfruit",
	"dragon fruit",
	"rhubarb",
	"tomato",
	"bell pepper",
	// floral and herbal
	"jasmine",
	"rose",
	"lavender",
	"violet",
	"hibiscus",
	"elderflower",
	"orange blossom",
	"honeysuckle",
	"chamomile",
	"floral",
	"wildflower",
	"mint",
	"basil",
	"thyme",
	"rosemary",
	"sage",
	"lemongrass",
	"eucalyptus",
	"green tea",
	"black tea",
	"red tea",
	"earl grey",
	"oolong",
	"tea",
	"herbal",
	// sweet
	"honey",
	"wildflower honey",
	"brown sugar",
	"caramel",
	"molasses",
	"maple syrup",
	"maple",
	"toffee",
	"butterscotch",
	"vanilla",
	"custard",
	"creamy",
	"buttery",
	"shortbread",
	"biscuit",
	"graham cracker",
	"nougat",
	"praline",
	"marzipan",
	"fudge",
	"marshmallow",
	"cane sugar",
	"demerara",
	"panela",
	"sugarcane",
	"candy",
	"jammy",
	"jam",
	// chocolate and nuts
	"milk chocolate",
	"dark chocolate",
	"chocolate",
	"cocoa",
	"cocoa nibs",
	"cacao",
	"hazelnut",
	"almond",
	"walnut",
	"peanut",
	"pecan",
	"cashew",
	"macadamia",
	"nutty",
	// spice and other
	"cinnamon",
	"clove",
	"allspice",
	"nutmeg",
	"ginger",
	"cardamom",
	"black pepper",
	"anise",
	"licorice",
	"baking spice",
	"tobacco",
	"cedar",
	"pine",
	"sandalwood",
	"malt",
	"cola",
	"winey",
	"red wine",
	"rum",
	"whisky",
	"whiskey",
	"champagne",
	"juicy",
	"earthy",
	"smoky",
	"savory",
	"savoury",
	"umami",
	"cereal",
	"toast",
	"bread",
	"brioche",
	"pastry",
	"cake",
	"chai",
];

/** Candidates one page contributes from the vocabulary scan; the note lines add their own. */
export const MAX_SCANNED_TERMS = 24;

const escape = (term: string): string =>
	term.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * One alternation, longest term first so "black cherry" wins over "cherry"
 * at the same position. A term is a whole word: no letter and no hyphen on
 * either side, so "cherry" inside "cherry-picked" is not a note.
 */
const FLAVOR_SCAN = new RegExp(
	`(?<![\\p{L}-])(?:${[...FLAVOR_TERMS]
		// oxlint-disable-next-line unicorn/no-array-sort -- ES2021 backend; the spread made a fresh array
		.sort((a, b) => b.length - a.length)
		.map(escape)
		.join("|")})(?![\\p{L}-])`,
	"giu"
);

/**
 * The vocabulary terms the text names, distinct (case-insensitive, kept as
 * the page spells them), in page order, capped at MAX_SCANNED_TERMS.
 */
export const scanFlavorTerms = (text: string): string[] => {
	const seen = new Set<string>();
	const found: string[] = [];
	for (const match of text.matchAll(FLAVOR_SCAN)) {
		const term = match[0].replaceAll(/\s+/gu, " ");
		const key = term.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			found.push(term);
			if (found.length >= MAX_SCANNED_TERMS) {
				break;
			}
		}
	}
	return found;
};
