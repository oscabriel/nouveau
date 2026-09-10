import { describe, expect, test, vi } from "vitest";

import {
	classifyLot,
	extractRoasterNotes,
	isWholesale,
	MAX_PRODUCTS_JSON_PAGES,
	parseHtmlPage,
	parseLotAttributes,
	parseProductsJson,
	PRODUCTS_JSON_PAGE_SIZE,
	SHOPIFY_FETCH_HEADERS,
	shopifyProductsUrl,
	stripHtml,
	walkFeedPages,
} from "./extraction";

interface FeedProduct {
	body_html?: string;
	handle?: string;
	id: number;
	image?: { src?: string } | null;
	images?: { src?: string }[] | null;
	product_type?: string;
	tags?: string[] | string;
	title?: string;
	variants?: {
		available?: boolean | null;
		grams?: number | null;
		price?: string | number;
		title?: string;
	}[];
}

const feedProduct = (
	id: number,
	extra: Partial<FeedProduct> = {}
): FeedProduct => ({
	handle: `lot-${id}`,
	id,
	// Fixtures model a typed coffee; the untyped default is "not a lot" (§16).
	product_type: "Coffee",
	title: `Lot ${id}`,
	variants: [{ available: true, grams: 250, price: "18.00", title: "250g" }],
	...extra,
});

const feedBody = (products: FeedProduct[]): string =>
	JSON.stringify({ products });

const fullPage = (startId: number): string =>
	feedBody(
		Array.from({ length: PRODUCTS_JSON_PAGE_SIZE }, (_, i) =>
			feedProduct(startId + i)
		)
	);

describe("shopifyProductsUrl", () => {
	test("targets the shop origin with the page size and page number", () => {
		expect(shopifyProductsUrl("https://shop.example.com/collections/all")).toBe(
			"https://shop.example.com/products.json?limit=250&page=1"
		);
		expect(shopifyProductsUrl("https://shop.example.com", 3)).toBe(
			"https://shop.example.com/products.json?limit=250&page=3"
		);
	});
});

describe("SHOPIFY_FETCH_HEADERS", () => {
	test("pins the US market so Shopify Markets cannot convert prices", () => {
		expect(SHOPIFY_FETCH_HEADERS.cookie).toBe("localization=US");
		expect(SHOPIFY_FETCH_HEADERS.accept).toBe("application/json");
	});
});

describe("isWholesale", () => {
	test("matches product_type", () => {
		expect(isWholesale("Wholesale Coffee", [])).toBe(true);
		expect(isWholesale("Wholesale Supplies and Equipment", [])).toBe(true);
		expect(isWholesale("Coffee", [])).toBe(false);
	});

	test("matches the title (Ruby's '- Wholesale', Madcap's '(WS)')", () => {
		expect(isWholesale("Coffee", [], "Ethiopia Reko - Wholesale")).toBe(true);
		expect(
			isWholesale("Coffee", [], "Ruby Camo Snapback Cap - WholesaleMerch")
		).toBe(true);
		expect(isWholesale("Single Origin", [], "Karinga (WS)")).toBe(true);
		expect(isWholesale("Blend", [], "Fraction (Half-Caff - WS)")).toBe(true);
		expect(isWholesale("Coffee", [], "Kiamugumo AB")).toBe(false);
	});

	test("matches only tags whose whole value means wholesale-only", () => {
		expect(isWholesale("Coffee", ["Coffee", "wholesale-only"])).toBe(true);
		expect(isWholesale("Coffee", ["hide-from-retail"])).toBe(true);
		expect(isWholesale("Coffee", ["cafe-only", "ONYXCAFES"])).toBe(true);
		expect(isWholesale("Coffee", "single-origin, wholesale only")).toBe(true);
		expect(isWholesale("Coffee", "single-origin, retail")).toBe(false);
	});

	test("'also sold wholesale' tags on retail coffees are not wholesale", () => {
		// Sweet Bloom, Merit, Heart and Blossom tag their retail bags this way.
		expect(
			isWholesale("Coffee Offerings", ["coffee", "wholesale-coffee"])
		).toBe(false);
		expect(isWholesale("Coffee", ["MB Espresso", "Normal Wholesale"])).toBe(
			false
		);
		expect(isWholesale("Beans", ["Single Origin", "wholesale"])).toBe(false);
		expect(isWholesale("Coffee", ["Coffee", "Light roast", "Wholesale"])).toBe(
			false
		);
	});

	test("treats missing fields as retail", () => {
		expect(isWholesale(null, null)).toBe(false);
	});
});

describe("parseProductsJson", () => {
	test("throws on a body that is not a products feed", () => {
		expect(() => parseProductsJson('{"collections":[]}')).toThrow(TypeError);
		expect(() => parseProductsJson("<html></html>")).toThrow();
	});

	test("maps products and variants, converting prices to cents", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(1, {
					variants: [
						{ available: true, grams: 340, price: "19.50", title: "12oz" },
						{ available: false, grams: null, price: 64, title: "5lb" },
						{ available: null, price: "n/a" },
					],
				}),
			])
		);
		expect(page.feedCount).toBe(1);
		expect(page.products).toEqual([
			{
				externalId: "1",
				handle: "lot-1",
				lotCopy: {},
				name: "Lot 1",
				variants: [
					{ available: true, grams: 340, name: "12oz", priceCents: 1950 },
					{ available: false, name: "5lb", priceCents: 6400 },
					{ available: false, name: "Default", priceCents: 0 },
				],
			},
		]);
	});

	test("falls back to the handle as externalId when the id is missing", () => {
		const page = parseProductsJson(
			JSON.stringify({
				products: [{ handle: "no-id", product_type: "Coffee", title: "No Id" }],
			})
		);
		expect(page.products[0]).toMatchObject({
			externalId: "no-id",
			variants: [],
		});
	});

	test("filters wholesale SKUs but reports the raw feed count", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(1),
				feedProduct(2, { product_type: "Wholesale" }),
				feedProduct(3, { title: "Lot 3 - Wholesale" }),
				feedProduct(4, { tags: "gift, Wholesale-only" }),
			])
		);
		expect(page.feedCount).toBe(4);
		expect(page.products.map((p) => p.externalId)).toEqual(["1"]);
	});

	test("drops non-lots and reports their ids so the crawl can purge them (§16)", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(1),
				feedProduct(2, {
					product_type: "Coffee Scales",
					title: "Acaia Pearl Scale",
				}),
				feedProduct(3, {
					product_type: "Coffee",
					title: "12 Month Gift Subscription",
				}),
				feedProduct(4, { product_type: "", tags: [], title: "Puck Screens" }),
				feedProduct(5, { product_type: "Wholesale Coffee" }),
			])
		);
		expect(page.feedCount).toBe(5);
		expect(page.products.map((p) => p.externalId)).toEqual(["1"]);
		expect(page.rejectedExternalIds).toEqual(["2", "3", "4", "5"]);
	});
});

// Every case below is a real product from a seed roaster's feed, sampled
// 2026-09-10. The classifier is only as good as the vocabulary it saw.
const lot = (productType: string, tags: string[], title: string): boolean =>
	classifyLot({ productType, tags, title }).isLot;

describe("classifyLot (§16)", () => {
	test("a typed coffee is a lot", () => {
		expect(lot("Coffee", ["Coffee Type: Single Origin"], "Kiamugumo AB")).toBe(
			true
		);
		expect(lot("Whole Bean Coffee", [], "Colombia Los Guacharos")).toBe(true);
		expect(lot("Beans", [], "Phono")).toBe(true);
		expect(lot("Blend", [], "Third Coast")).toBe(true);
		expect(lot("Single Origin", [], "Dog Days")).toBe(true);
		expect(lot("Espresso", [], "Owl's Howl")).toBe(true);
		expect(lot("Coffee Bag", [], "Cipres")).toBe(true);
		expect(lot("Coffee Offerings", [], "Jhonny Alvarado")).toBe(true);
		expect(lot("Coffee - NoSubscribe", [], "Flatlander Signature Blend")).toBe(
			true
		);
		expect(lot("Coffees", [], "2026 Mate Matiwos; Keramo - Ethiopia")).toBe(
			true
		);
	});

	test("instant coffee is a lot: the issue's own example", () => {
		expect(lot("Instant Coffee", [], "Instant Guatemala Finca Pampojila")).toBe(
			true
		);
		expect(lot("Coffee", [], "Instant Espresso Black Cat Classic")).toBe(true);
		// A blend for cold brewing is still a bagged blend.
		expect(lot("Coffee", ["Coffee Type: Blend"], "Cold Coffee Blend")).toBe(
			true
		);
	});

	test("roaster-specific coffee type names are lots", () => {
		// Coava's whole-bean type is "Brewed Coffee"; PT's sold-out coffees sit
		// under "Past Offerings Collection"; Proud Mary archives under
		// "coffee-archive" and lists presales under "upcoming-coffees".
		expect(lot("Brewed Coffee", ["Washed", "Guatemala"], "Nayo Ovalle")).toBe(
			true
		);
		expect(lot("Past Offerings Collection", [], "Yacuri Sidra Washed")).toBe(
			true
		);
		expect(
			lot(
				"coffee-archive",
				["Coffee", "From: El Salvador"],
				"El Salvador | Siberia | Red Bourbon | Natural | Filter"
			)
		).toBe(true);
		expect(
			lot(
				"upcoming-coffees",
				[],
				"ETHIOPIA | Solo Daye Bensa | Heirloom | Natural | 2026"
			)
		).toBe(true);
	});

	test("a multi-valued type with one coffee segment is a lot (Stumptown)", () => {
		expect(
			lot(
				"Coffee/Africa,Coffee/Asia Pacific,Coffee/Latin America,Gifts",
				["Coffee Type: Blend"],
				"Evergreen"
			)
		).toBe(true);
	});

	test("subscription-eligibility tags on typed coffees are not subscriptions", () => {
		expect(
			lot(
				"Coffee",
				["Coffee Type: Single Origin", "Filter: Subscription Eligible"],
				"Guatemala El Injerto Bourbon"
			)
		).toBe(true);
		expect(
			lot("Coffee", ["coffee", "subscription", "year-round"], "Hologram")
		).toBe(true);
		expect(
			lot("Blend", ["Coffee", "Recharge-Check-Needed", "subscription"], "Spark")
		).toBe(true);
		expect(lot("Beans", ["Single Origin", "Subscription"], "Phono")).toBe(true);
		expect(lot("Blends", ["Bottomless", "recharge"], "Banner Dark")).toBe(true);
		expect(lot("Coffee", ["Blend Subscription Tag", "Recharge"], "Aster")).toBe(
			true
		);
	});

	test("an unknown type falls through to tags, then title", () => {
		expect(lot("Organic", [], "Organic August Seasonal Blend")).toBe(true);
		expect(
			lot(
				"Organic",
				["Medium Roast", "Organic", "Peru"],
				"Organic Tomorrow Seasonal Project"
			)
		).toBe(true);
		expect(
			lot(
				"",
				["coffee", "instant", "Colombia"],
				"Instant Costa Rica Don Joel Kenia"
			)
		).toBe(true);
		expect(
			lot("", ["Instant Craft Coffee", "New Site"], "Instant Passeio")
		).toBe(true);
		expect(lot("", [], "Rising Star Mill Seasonal Blend")).toBe(true);
		expect(lot("", [], "2022 Ikizena Hill - Rwanda")).toBe(true);
		expect(lot("", [], "The Jijon-Quan coffee!")).toBe(true);
	});

	test("wholesale is still the first rule", () => {
		expect(lot("Wholesale Coffee", [], "Ethiopia Reko - Wholesale")).toBe(
			false
		);
		expect(
			lot(
				"Single Origin",
				["Coffee", "wholesale", "wholesale-only"],
				"Karinga (WS)"
			)
		).toBe(false);
		expect(
			lot(
				"Coffee",
				["cafe-only", "coffee", "wholesale-coffee"],
				"Geometry - Cafes Only"
			)
		).toBe(false);
		expect(
			lot("Coffee", ["coffee"], "Costa Rica Volcan Azul SL28 - Cafe Only")
		).toBe(false);
	});

	test("retail coffees that are also sold wholesale are lots", () => {
		expect(
			lot("Coffee Offerings", ["coffee", "wholesale-coffee"], "Jhonny Alvarado")
		).toBe(true);
		expect(
			lot("Coffee", ["MB Espresso", "Normal Wholesale"], "Kiamugumo AB")
		).toBe(true);
		expect(
			lot("Beans", ["Single Origin", "wholesale"], "Kenya Gachuiro AB")
		).toBe(true);
		expect(
			lot(
				"Coffee",
				["Coffee", "wholesale-coffee"],
				"Decaf Colombia Sebastian Ramirez Red Fruits"
			)
		).toBe(true);
	});

	test("equipment, merch and consumables typed as such are not lots", () => {
		expect(lot("Coffee Scales", [], "Acaia Pearl Scale")).toBe(false);
		expect(lot("Tea", [], "Black Tea Box Set")).toBe(false);
		expect(lot("Brewed Tea", [], "Sencha")).toBe(false);
		expect(lot("Coffee Grinder", [], "Fellow Ode")).toBe(false);
		expect(
			lot("Coffee Filters", [], "Kalita Wave 185 Paper Filter (100ct)")
		).toBe(false);
		expect(lot("Gear/Merch,Gear/Mugs", [], "Gold Diner Mug")).toBe(false);
		expect(lot("Merchandise", [], "Run Club Tee")).toBe(false);
		expect(lot("Warehouse", ["Cafe-Supplies"], "Food Paper Box (Onyx)")).toBe(
			false
		);
		expect(lot("Lattes + Cold Coffee", [], "Cold Coffee 12 Pack")).toBe(false);
		expect(lot("Coffee", ["Hidden"], "Chicago Marathon Cold Coffee 6pk")).toBe(
			false
		);
		expect(lot("Coffee", ["Product Line: RTD"], "Cold Coffee")).toBe(false);
		expect(lot("Cold Brew", [], "Cold Brew Stubbies")).toBe(false);
		expect(lot("RTD", [], "Draft Latte")).toBe(false);
		expect(lot("Chocolate", [], "70% Tanzania | Dark & Lemon Crunch")).toBe(
			false
		);
		expect(lot("Gift Cards", [], "Gift Card")).toBe(false);
		expect(lot("Club", [], "Human Resources Coffee Club")).toBe(false);
		expect(lot("Series", [], "Single Origin Series")).toBe(false);
		expect(lot("Preset Box", [], "The Onyx Cometeer Collection")).toBe(false);
		expect(lot("Gifts", [], "Origin Sticker Pack")).toBe(false);
		expect(lot("Goods", [], "Essential Canister")).toBe(false);
		expect(lot("Events", [], "Guided Brewing Classes and Tour")).toBe(false);
	});

	test("a coffee-typed item whose title says otherwise is not a lot", () => {
		expect(lot("Coffee", [], "12 Month Gift Subscription")).toBe(false);
		expect(lot("Coffee", [], "Blend Box Subscription")).toBe(false);
		expect(lot("Coffee", [], "Season's Best Bundle")).toBe(false);
		expect(lot("Coffee", [], "Corsica K-Cup Pods")).toBe(false);
		expect(lot("Coffee", [], "Decaf Espresso Capsules")).toBe(false);
		expect(lot("Coffee", [], "Instant Oat Latte")).toBe(false);
		expect(lot("Coffee", [], "Bulk Coffee")).toBe(false);
		expect(lot("Coffee", [], "Around the World Gift Box")).toBe(false);
		expect(lot("Coffee", [], "Corsica - 3oz Filter Packs")).toBe(false);
		expect(
			lot(
				"Coffee",
				["Instant", "Types: Blend"],
				"Aster Craft Instant Coffee 6 Pack"
			)
		).toBe(false);
		expect(lot("Coffee", ["bundle", "coffee"], "Classic Cup Pack")).toBe(false);
		expect(lot("Beans", [], "heart sample pack")).toBe(false);
		expect(lot("Blend", [], "dito Tasting Set")).toBe(false);
		expect(
			lot("coffee-archive", [], "Comandante X25 Trailmaster Coffee Grinder")
		).toBe(false);
		expect(lot("Brewed Coffee", [], "Kilenso (Subscription)")).toBe(false);
		expect(lot("Brewed Coffee", [], "S.O. Blend (Add-On)")).toBe(false);
		expect(lot("Coffee", ["Coffee Type: Gift Set"], "Passport Trio")).toBe(
			false
		);
		expect(lot("Coffee", [], "Producer Experience Box - Jamison Savage")).toBe(
			false
		);
		expect(lot("WPD", [], "WPD Test Product - ( DO NOT BUY )")).toBe(false);
		expect(lot("", [], "Decaf Espresso - Peru Norandino - Sample Only")).toBe(
			false
		);
		expect(lot("Coffee", ["Sample", "Wholesale"], "Coffee Samples")).toBe(
			false
		);
		expect(lot("Brewed Coffee", [], "Tester Coffee")).toBe(false);
	});

	test("a tag naming a non-lot beats a coffee type", () => {
		expect(
			lot(
				"Coffee",
				["Coffee Type: Subscription Only", "Filter: 5 LB Bags"],
				"Roaster's Pick"
			)
		).toBe(false);
		expect(lot("Coffee", ["Coffee Type: Bundle"], "Holiday Trio")).toBe(false);
		expect(
			lot(
				"coffee",
				["Cometeer", "Shopify Collective"],
				"The Cometeer Proud Mary Selection"
			)
		).toBe(false);
		expect(lot("", ["bigface", "white-label"], "IO-E-20")).toBe(false);
		expect(lot("", ["recharge"], "2lb Decaffeinated")).toBe(false);
		expect(
			lot(
				"",
				["Shopify Collective", "Third Wave Water"],
				"Third Wave Water Medium Roast Profile"
			)
		).toBe(false);
		expect(
			lot("", ["Equipment", "Shopify Collective"], "Espresso Series 1")
		).toBe(false);
		expect(
			lot("", ["internalsupplies", "wholesale-only"], "8oz Hot Cup Lid")
		).toBe(false);
		expect(
			lot(
				"Coffee",
				["Badge: Rotating Subscription", "Coffee Type: Blend"],
				"Intelligentsia Classics"
			)
		).toBe(false);
		// A subscription key with another value is eligibility, not a subscription.
		expect(
			lot(
				"Coffee",
				["Subscription: Enabled", "Coffee Type: Single Origin"],
				"Burundi Mugano"
			)
		).toBe(true);
	});

	test("untyped items need a coffee signal; hard goods and consumables never pass", () => {
		expect(lot("", [], "Monthly 250g Coffee")).toBe(false);
		expect(lot("", [], "Roasted Coffee - Recurring - 12 Installments")).toBe(
			false
		);
		expect(lot("", [], "Coffee Subscription Plan")).toBe(false);
		expect(lot("", [], "Cometeer: Regalia Capsules (NYC Pickup Only)")).toBe(
			false
		);
		expect(lot("", [], "Iced Coffee Tote")).toBe(false);
		expect(lot("", [], "Tomorrow River Airscape Coffee Canister")).toBe(false);
		expect(lot("", [], "AeroPress Go Plus")).toBe(false);
		expect(lot("", [], "Rishi Organic Chamomile Medley Tea Sachets")).toBe(
			false
		);
		expect(lot("", [], "The Physics of Espresso")).toBe(false);
		expect(lot("", [], "World Atlas of Coffee")).toBe(false);
		expect(lot("", [], 'Hoop "Pulsar" Fast-Flowing Paper Filters')).toBe(false);
		expect(lot("", [], "Community Brewing")).toBe(false);
		expect(lot("", [], "Puck Screens")).toBe(false);
		expect(lot("", [], "MOONRAKER")).toBe(false);
		expect(lot("", [], "'From Atlanta' 2025 Hoodie")).toBe(false);
		expect(lot("", [], "Cozy Coffee Socks")).toBe(false);
		expect(lot("", [], "Colorful Coffees Cold Cup")).toBe(false);
		expect(lot("", [], "Bird And The Bees Honey")).toBe(false);
	});

	test("comma-string tags work like array tags", () => {
		expect(
			classifyLot({
				productType: "",
				tags: "coffee, instant",
				title: "Instant Kenia",
			}).isLot
		).toBe(true);
		expect(
			classifyLot({
				productType: "",
				tags: "recharge",
				title: "250g Caffeinated",
			}).isLot
		).toBe(false);
	});

	test("reports which rule decided", () => {
		expect(
			classifyLot({
				productType: "Coffee Scales",
				tags: [],
				title: "Acaia Pearl Scale",
			})
		).toEqual({ isLot: false, rule: "title" });
		expect(
			classifyLot({ productType: "Tea", tags: [], title: "Sencha" })
		).toEqual({ isLot: false, rule: "type" });
		expect(
			classifyLot({ productType: "Coffee", tags: [], title: "Kiamugumo AB" })
		).toEqual({ isLot: true, rule: "type" });
		expect(
			classifyLot({ productType: "", tags: [], title: "MOONRAKER" })
		).toEqual({ isLot: false, rule: "default" });
	});
});

describe("stripHtml", () => {
	test("strips tags, decodes entities, collapses whitespace", () => {
		expect(
			stripHtml(
				"<p>One of the&nbsp;longest harvest seasons <strong>ever</strong> — &amp; lovely.</p>"
			)
		).toBe("One of the longest harvest seasons ever — & lovely.");
	});

	test("block tags become paragraph breaks", () => {
		expect(
			stripHtml(
				"<h5>We Taste: lemon meringue - lavender - apricot - honey</h5><h5>Light Roast</h5><p>Roasted to order.</p>"
			)
		).toBe(
			"We Taste: lemon meringue - lavender - apricot - honey\nLight Roast\nRoasted to order."
		);
	});

	test("drops script and style bodies, not just their tags", () => {
		expect(
			stripHtml(
				"<style>.x{color:red}</style><p>Notes of plum.</p><script>track()</script>"
			)
		).toBe("Notes of plum.");
	});
});

describe("parseLotAttributes", () => {
	test("reads the Proud Mary convention", () => {
		expect(
			parseLotAttributes([
				"Coffee",
				"For: Filter",
				"From: Ethiopia",
				"Process: Natural",
			])
		).toEqual({ origin: "Ethiopia", process: "Natural" });
	});

	test("reads the Intelligentsia convention", () => {
		expect(
			parseLotAttributes(["Country: Guatemala", "Roast Level: Bright"])
		).toEqual({ origin: "Guatemala" });
	});

	test("keeps a Roast Level value only when it names an actual roast", () => {
		expect(parseLotAttributes(["Roast Level: Comforting"])).toEqual({});
		expect(parseLotAttributes(["Roast: Light"])).toEqual({
			roastLevel: "Light",
		});
		expect(parseLotAttributes(["Roast: Medium-Light"])).toEqual({
			roastLevel: "Medium-Light",
		});
		// Anchored: a roast word inside a taste phrase is not a roast level.
		expect(parseLotAttributes(["Roast: Lightly sweet & delightful"])).toEqual(
			{}
		);
	});

	test("takes a From: value only when it looks like a place", () => {
		expect(parseLotAttributes(["From: Colombia, Huila"])).toEqual({
			origin: "Colombia, Huila",
		});
		expect(parseLotAttributes(["From: our friends at the co-op"])).toEqual({});
		expect(parseLotAttributes(["From: 2024 harvest"])).toEqual({});
	});

	test("reads the Onyx convention and a bare process tag", () => {
		expect(parseLotAttributes(["origin:Ethiopia"])).toEqual({
			origin: "Ethiopia",
		});
		expect(parseLotAttributes(["amazing", "Washed", "Wholesale"])).toEqual({
			process: "Washed",
		});
	});

	test("tolerates string tags and noise", () => {
		expect(parseLotAttributes([])).toEqual({});
		expect(parseLotAttributes(["nope", ":", "From:"])).toEqual({});
	});
});

describe("extractRoasterNotes", () => {
	test("reads the Sey prose pattern", () => {
		expect(
			extractRoasterNotes(
				"This encore harvest delivery came as a wonderful surprise. In the cup we find peach, melon, red tea, and lovely florality.",
				[]
			)
		).toBe("peach, melon, red tea, and lovely florality");
	});

	test("reads the Ruby dash list", () => {
		// Ruby's real layout: the descriptor list is its own <h5>; the roast
		// level and info-sheet boilerplate live in separate blocks.
		expect(
			extractRoasterNotes(
				"We Taste: lemon meringue - lavender - apricot - honey\nLight Roast\nDOWNLOAD info sheets",
				[]
			)
		).toBe("lemon meringue - lavender - apricot - honey");
	});

	test("reads notes-of prose and stops at a dash", () => {
		expect(
			extractRoasterNotes(
				"Expect notes of jasmine, stone fruit, blackberry, & winey complexity — a beautiful example.",
				[]
			)
		).toBe("jasmine, stone fruit, blackberry, & winey complexity");
	});

	test("reads flavors-of prose", () => {
		expect(
			extractRoasterNotes(
				"Expect flavors of black currant, ruby grapefruit, and molasses.",
				[]
			)
		).toBe("black currant, ruby grapefruit, and molasses");
	});

	test("needs a word boundary before the lead-in", () => {
		// "Footnotes of" is not "notes of"; nothing here is a descriptor.
		expect(
			extractRoasterNotes(
				"Footnotes of the harvest were long. Hints of plum.",
				[]
			)
		).toBeNull();
	});

	test("drops a trailing connective left at a block boundary", () => {
		expect(
			extractRoasterNotes(
				"Notes of cherry, chocolate, and\nRoasted to order.",
				[]
			)
		).toBe("cherry, chocolate");
	});

	test("falls back to the Flavor Profile tag", () => {
		expect(
			extractRoasterNotes("A comfortable daily brew.", [
				"Country: Brazil",
				"Flavor Profile: Caramel + Stone Fruit",
			])
		).toBe("Caramel + Stone Fruit");
	});

	test("rejects in-the-cup prose without we find/taste", () => {
		// Real Verve copy: "in the cup, with a subtle pine-like character" is
		// narrative, not a descriptor list.
		expect(
			extractRoasterNotes(
				"in the cup, with a subtle pine-like character adding complexity without overwhelming the palate",
				[]
			)
		).toBeNull();
	});

	test("returns null when nothing matches", () => {
		expect(extractRoasterNotes("", [])).toBeNull();
		expect(extractRoasterNotes("Roasted to order.", [])).toBeNull();
	});

	test("caps the matched clause at a word boundary", () => {
		const notes = extractRoasterNotes(
			`In the cup we find ${"words ".repeat(60)}. Then something else.`,
			[]
		);
		expect(notes).not.toBeNull();
		expect(notes?.length).toBeLessThanOrEqual(200);
		expect(notes?.endsWith("words")).toBe(true);
	});
});

describe("parseProductsJson lot copy (§14.4)", () => {
	test("carries description, tags, image, attributes and notes", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(1, {
					body_html:
						"<p>A washed lot from Urrao.</p> In the cup we find peach, melon, and red tea.",
					image: { src: "https://cdn.example.com/lot.png?v=1" },
					tags: ["Coffee", "From: Colombia", "Process: Washed"],
					title: "La Casita",
				}),
			])
		);
		expect(page.products[0]).toEqual({
			externalId: "1",
			handle: "lot-1",
			lotCopy: {
				description:
					"A washed lot from Urrao. In the cup we find peach, melon, and red tea.",
				imageUrl: "https://cdn.example.com/lot.png?v=1",
				origin: "Colombia",
				process: "Washed",
				roasterNotes: "peach, melon, and red tea",
				tags: ["Coffee", "From: Colombia", "Process: Washed"],
			},
			name: "La Casita",
			variants: [
				{ available: true, grams: 250, name: "250g", priceCents: 1800 },
			],
		});
	});

	test("always carries lotCopy, empty when the feed publishes none", () => {
		// products.json is authoritative for the copy: an empty lotCopy is a
		// statement ("nothing published"), not an unknown.
		const page = parseProductsJson(
			feedBody([feedProduct(2, { body_html: "", tags: [] }), feedProduct(3)])
		);
		expect(page.products[0]).toStrictEqual({
			externalId: "2",
			handle: "lot-2",
			lotCopy: {},
			name: "Lot 2",
			variants: expect.anything(),
		});
		expect(page.products[1]?.lotCopy).toStrictEqual({});
	});

	test("reads the first image and comma-string tags", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(4, {
					images: [
						{},
						{ src: "https://cdn.example.com/first.png" },
						{ src: "https://cdn.example.com/second.png" },
					],
					tags: "gift, From: Kenya, Washed",
					title: "Karimikui",
				}),
			])
		);
		expect(page.products[0]?.lotCopy).toMatchObject({
			imageUrl: "https://cdn.example.com/first.png",
			origin: "Kenya",
			process: "Washed",
			tags: ["gift", "From: Kenya", "Washed"],
		});
	});

	test("caps the description", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(5, { body_html: `<p>${"word ".repeat(2000)}</p>` }),
			])
		);
		const [product] = page.products;
		expect(product?.lotCopy?.description?.length).toBeLessThanOrEqual(2000);
	});
});

describe("walkFeedPages", () => {
	const websiteUrl = "https://shop.example.com";

	test("stops after a first page that is not full", async () => {
		const fetchPage = vi.fn(() => Promise.resolve<string | null>(null));
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(feedBody([feedProduct(1)])),
			websiteUrl,
		});
		expect(fetchPage).not.toHaveBeenCalled();
		expect(result).toEqual({
			pageError: null,
			products: [expect.objectContaining({ externalId: "1" })],
			rejectedExternalIds: [],
		});
	});

	test("walks sequential pages while the raw feed is full", async () => {
		const pages: Record<string, string> = {
			[shopifyProductsUrl(websiteUrl, 2)]: fullPage(251),
			[shopifyProductsUrl(websiteUrl, 3)]: feedBody([feedProduct(501)]),
		};
		const fetchPage = vi.fn((url: string) =>
			Promise.resolve(pages[url] ?? null)
		);
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([
			shopifyProductsUrl(websiteUrl, 2),
			shopifyProductsUrl(websiteUrl, 3),
		]);
		expect(result.pageError).toBeNull();
		expect(result.products).toHaveLength(501);
	});

	test("uses the raw feed count, not the filtered count, to continue", async () => {
		// Page 1 is full in the feed but every product is wholesale.
		const wholesaleFirst = feedBody(
			Array.from({ length: PRODUCTS_JSON_PAGE_SIZE }, (_, i) =>
				feedProduct(i + 1, { product_type: "Wholesale" })
			)
		);
		const firstPage = parseProductsJson(wholesaleFirst);
		expect(firstPage.products).toHaveLength(0);
		const fetchPage = vi.fn(() =>
			Promise.resolve(feedBody([feedProduct(999)]))
		);
		const result = await walkFeedPages({ fetchPage, firstPage, websiteUrl });
		expect(fetchPage).toHaveBeenCalledTimes(1);
		expect(result.products.map((p) => p.externalId)).toEqual(["999"]);
	});

	test("merges duplicate externalIds across pages (last wins)", async () => {
		const fetchPage = vi.fn(() =>
			Promise.resolve(feedBody([feedProduct(1, { title: "Lot 1 (renamed)" })]))
		);
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(result.products).toHaveLength(PRODUCTS_JSON_PAGE_SIZE);
		expect(result.products.find((p) => p.externalId === "1")?.name).toBe(
			"Lot 1 (renamed)"
		);
	});

	test("discards the whole catalog when a later page is unavailable", async () => {
		const fetchPage = vi.fn(() => Promise.resolve<string | null>(null));
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(result).toEqual({
			pageError: "products.json page 2 unavailable; partial catalog discarded",
			products: [],
			rejectedExternalIds: [],
		});
	});

	test("unions the rejected ids across pages (§16)", async () => {
		const page2 = feedBody([
			feedProduct(900),
			feedProduct(901, { product_type: "Merch", title: "Tote" }),
		]);
		const fetchPage = vi.fn(() => Promise.resolve(page2));
		const firstPage = parseProductsJson(
			feedBody([
				...Array.from({ length: PRODUCTS_JSON_PAGE_SIZE - 1 }, (_, i) =>
					feedProduct(i + 1)
				),
				feedProduct(500, { product_type: "Tea", title: "Sencha" }),
			])
		);
		const result = await walkFeedPages({ fetchPage, firstPage, websiteUrl });
		expect(result.pageError).toBeNull();
		expect(result.rejectedExternalIds).toEqual(["500", "901"]);
		expect(result.products).toHaveLength(PRODUCTS_JSON_PAGE_SIZE);
	});

	test("discards the whole catalog when a later page is not a feed", async () => {
		const fetchPage = vi.fn(() => Promise.resolve("<html>blocked</html>"));
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(result.pageError).toContain("page 2 unavailable");
		expect(result.products).toEqual([]);
	});

	test("caps the walk at MAX_PRODUCTS_JSON_PAGES and warns when still full", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchPage = vi.fn((url: string) => {
			const page = Number(new URL(url).searchParams.get("page"));
			return Promise.resolve(
				fullPage((page - 1) * PRODUCTS_JSON_PAGE_SIZE + 1)
			);
		});
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(fetchPage).toHaveBeenCalledTimes(MAX_PRODUCTS_JSON_PAGES - 1);
		expect(result.products).toHaveLength(
			MAX_PRODUCTS_JSON_PAGES * PRODUCTS_JSON_PAGE_SIZE
		);
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});
});

describe("parseHtmlPage", () => {
	const pageUrl = "https://roaster.example.com/shop/";

	test("returns nothing for a non-matching extraction", () => {
		expect(parseHtmlPage(null, pageUrl)).toEqual([]);
		expect(parseHtmlPage({ products: "nope" }, pageUrl)).toEqual([]);
	});

	test("drops items without a name", () => {
		expect(
			parseHtmlPage(
				{ products: [{ name: "", price: 1 }, { price: 2 }] },
				pageUrl
			)
		).toEqual([]);
	});

	test("keys URL-bearing items on their URL", () => {
		const [product] = parseHtmlPage(
			{
				products: [
					{
						available: false,
						grams: 250,
						name: "Kiamabara",
						price: 22.5,
						url: "https://roaster.example.com/products/kiamabara",
					},
				],
			},
			pageUrl
		);
		expect(product).toEqual({
			externalId: "https://roaster.example.com/products/kiamabara",
			handle: "kiamabara",
			name: "Kiamabara",
			variants: [
				{ available: false, grams: 250, name: "Default", priceCents: 2250 },
			],
		});
	});

	test("keys URL-less items on page + name so they do not collapse", () => {
		const products = parseHtmlPage(
			{
				products: [
					{ name: "Lot A", price: 18 },
					{ name: "Lot B", price: 20 },
				],
			},
			pageUrl
		);
		expect(products.map((p) => p.externalId)).toEqual([
			"https://roaster.example.com/shop#Lot A",
			"https://roaster.example.com/shop#Lot B",
		]);
		expect(products.every((p) => p.handle === "shop")).toBe(true);
	});

	test("defaults availability to true and price to 0", () => {
		const [product] = parseHtmlPage({ products: [{ name: "Lot" }] }, pageUrl);
		expect(product?.variants[0]).toEqual({
			available: true,
			name: "Default",
			priceCents: 0,
		});
	});
});
