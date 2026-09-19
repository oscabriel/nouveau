import { describe, expect, test, vi } from "vitest";

import {
	classifyLot,
	extractRoasterNotes,
	fetchFirstFeedPage,
	isWholesale,
	MAX_PRODUCTS_JSON_PAGES,
	parseLotAttributes,
	parseProductsJson,
	parseVariantGrams,
	pageFactCandidates,
	pageTextFromHtml,
	PRODUCTS_JSON_PAGE_SIZE,
	SHOPIFY_FETCH_HEADERS,
	shopifyProductsUrl,
	stripHtml,
	themeNotesFromHtml,
	verifyPageFacts,
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
	vendor?: string;
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
						{ available: true, grams: 397, price: "20", title: "12 oz." },
					],
				}),
			])
		);
		expect(page.feedCount).toBe(1);
		expect(page.products).toEqual([
			{
				externalId: "1",
				handle: "lot-1",
				lotCopy: { productType: "Coffee" },
				name: "Lot 1",
				variants: [
					{ available: true, grams: 340, name: "12oz", priceCents: 1950 },
					{ available: false, grams: 2268, name: "5lb", priceCents: 6400 },
					{ available: false, name: "Default", priceCents: 0 },
					// East Pole: Shopify grams is the shipping weight (397); the name wins.
					{ available: true, grams: 340, name: "12 oz.", priceCents: 2000 },
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

	test("a rejected item with no id or handle is not reported (nothing to purge by)", () => {
		const page = parseProductsJson(
			JSON.stringify({
				products: [{ product_type: "Merch", title: "Tote" }, feedProduct(1)],
			})
		);
		expect(page.products.map((p) => p.externalId)).toEqual(["1"]);
		expect(page.rejectedExternalIds).toEqual([]);
	});

	test("a default rejection becomes a shadow candidate; a named one does not (§16)", () => {
		const page = parseProductsJson(
			feedBody([
				// Hard non-lot signals name their reason: no shadow check needed.
				feedProduct(1, { product_type: "Merch", title: "Tote" }),
				// The ambiguous tail: untyped, untagged, nothing to read.
				feedProduct(2, {
					body_html: "<p>Sun-dried Sidamo, roasted last Tuesday.</p>",
					product_type: "",
					tags: [],
					title: "Special Release",
				}),
				// Untyped and untagged, but the title says gift card.
				feedProduct(3, { product_type: "", title: "Gift Card" }),
			])
		);
		expect(page.shadowCandidates).toEqual([
			{
				description: "Sun-dried Sidamo, roasted last Tuesday.",
				externalId: "2",
				title: "Special Release",
			},
		]);
	});

	test("shadow candidates are deduped across pages by externalId", async () => {
		const websiteUrl = "https://shop.example.com";
		const page2 = feedBody([
			feedProduct(2, { title: "Special Release (restock)" }),
		]);
		const fetchPage = vi.fn(() => Promise.resolve(page2));
		const firstPage = parseProductsJson(
			feedBody([
				...Array.from({ length: PRODUCTS_JSON_PAGE_SIZE - 1 }, (_, i) =>
					feedProduct(i + 1)
				),
				feedProduct(2, {
					product_type: "",
					tags: [],
					title: "Special Release",
				}),
			])
		);
		const result = await walkFeedPages({ fetchPage, firstPage, websiteUrl });
		expect(result.shadowCandidates).toHaveLength(1);
		expect(result.shadowCandidates[0]?.externalId).toBe("2");
	});
});

// Every case below is a real product from a seed roaster's feed, sampled
// 2026-09-10. The classifier is only as good as the vocabulary it saw.
const lot = (productType: string, tags: string[], title: string): boolean =>
	classifyLot({ productType, tags, title }).isLot;

describe("parseVariantGrams (#28)", () => {
	test.each([
		// The audit's mismatches: the name is right, Shopify grams is shipping weight.
		["12 oz.", 397, 340],
		["2 lb.", 1134, 907],
		["12oz", 0, 340],
		["1lb", 0, 454],
		["125g", 454, 125],
		["2lb / Whole Bean", 340, 907],
		["10 OZ / Whole Bean", 340, 283],
		["8oz", 326, 227],
		["5lb", 363, 2268],
		["2lb Whole Bean", 15_241, 907],
		["1kg / Ground for Espresso", 250, 1000],
		// Conventions seen across the 20 feeds.
		["250gms / Whole Bean", 250, 250],
		["250gm Wholebean", 0, 250],
		["100gms / Small", 0, 100],
		["5lbs", 0, 2268],
		["2.2 LBS / Whole Bean", 0, 998],
		["1 KILO / Whole Bean", 0, 1000],
		["Drip - Whole Bean / 2 KILO", 0, 2000],
		["1 x 300 gram bag", 0, 300],
		["1.5 lb (24 oz) / Whole Bean", 0, 680],
		["2lb (.9kg)", 0, 907],
		["10.9oz / Whole Bean", 0, 309],
		["Whole Bean / 12 OZ", 0, 340],
		["Aster / 70g", 0, 70],
		["8oz / 25%", 0, 227],
		["50g jar w/gift box", 0, 50],
	])("%s (Shopify %d g) -> %d g", (name, shopifyGrams, expected) => {
		expect(parseVariantGrams(name, [], shopifyGrams)).toBe(expected);
	});

	test.each([
		["2 x 250g bags", 500],
		["2x 8oz — Whole Bean", 454],
		["6 x 284g", 1704],
		["12 - 4oz bags", 1361],
		["5x 100G Tin", 500],
		["10oz Case Pack (6)", 1701],
		["5lbs Case Pack (8)", 18_144],
	])("multi-packs weigh count times size: %s -> %d g", (name, expected) => {
		expect(parseVariantGrams(name, [], 0)).toBe(expected);
	});

	test("reads option values when the title carries no size", () => {
		expect(parseVariantGrams("Default Title", ["Whole Bean", "12oz"], 0)).toBe(
			340
		);
	});

	test("falls back to a positive Shopify weight only when no size is named", () => {
		expect(parseVariantGrams("Whole Bean", [], 340)).toBe(340);
		expect(parseVariantGrams("Default Title", [], 0)).toBeUndefined();
		expect(parseVariantGrams("Default Title", [], null)).toBeUndefined();
		expect(parseVariantGrams("1 Bag / Drip", [], 0)).toBeUndefined();
		expect(parseVariantGrams("$25 Gift Card", [], 0)).toBeUndefined();
	});

	test("a bare number or a grind word is not a size", () => {
		expect(parseVariantGrams("10 Pack", [], 0)).toBeUndefined();
		expect(parseVariantGrams("Ground", [], 0)).toBeUndefined();
		expect(parseVariantGrams("Grind for Espresso", [], 0)).toBeUndefined();
	});
});

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

	test("a typed coffee named for its brew method is a lot", () => {
		// Blossom: whole bean, 12 oz to 5 lb bags, typed Coffee.
		expect(
			lot(
				"Coffee",
				[
					"Blend",
					"Bottomless",
					"Coffee",
					"colombia",
					"medium roast",
					"Wholesale",
				],
				"Cold Brew Blend"
			)
		).toBe(true);
		expect(lot("Coffee", [], "Cold Brew Blend - Whole Bean")).toBe(true);
		expect(lot("Coffee", [], "Aeropress Championship Blend")).toBe(true);
		expect(lot("Coffee", [], "Chemex Blend")).toBe(true);
		// The drinkable kind still names its container, type, tag or count.
		expect(lot("Coffee", [], "Nitro Cold Brew")).toBe(false);
		expect(lot("Coffee", [], "Cold Brew - 4 Cans")).toBe(false);
		expect(lot("Coffee", [], "Cold Brew 12oz Can")).toBe(false);
		expect(lot("Coffee", [], "Cold Brew Stubbies")).toBe(false);
		expect(lot("Cold Brew", [], "Cold Brew")).toBe(false);
		expect(lot("Coffee", ["Product Line: RTD"], "Cold Brew")).toBe(false);
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

	test("untyped: a place or craft word outranks an ambiguous title word", () => {
		// honey the process, cup as in Cup of Excellence, chocolate the note.
		expect(lot("", [], "Costa Rica Las Lajas Black Honey")).toBe(true);
		expect(lot("", [], "Colombia Cup of Excellence #4")).toBe(true);
		expect(lot("", [], "Chocolate Bomb Espresso")).toBe(true);
		// Without one, the ambiguous word is the product.
		expect(lot("", [], "Bird And The Bees Honey")).toBe(false);
		expect(lot("", [], "Coffee Blossom Honey 12oz")).toBe(false);
		expect(lot("", [], "Colorful Coffees Cold Cup")).toBe(false);
		// Hard words win even next to a place: tea from Kenya is tea.
		expect(lot("", [], "Kenya Black Tea")).toBe(false);
		expect(lot("", [], "Cold Brew Coffee 32oz")).toBe(false);
	});

	test("untyped: a tasting-note tag does not outvote a coffee tag", () => {
		expect(lot("", ["Ethiopia", "tea", "floral"], "Worka Sakaro")).toBe(true);
		expect(lot("", ["chocolate", "Brazil"], "Fazenda Sertao")).toBe(true);
		// Alone, the weak tag still names the product.
		expect(lot("", ["tea"], "Sencha")).toBe(false);
		expect(lot("", ["recharge"], "2lb Decaffeinated")).toBe(false);
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

	test("brewing water is a hard good even under a Coffee category; water-process decafs are lots", () => {
		expect(
			classifyLot({
				productType: "Coffee,Merch",
				tags: [],
				title: "Third Wave Water-Espresso Profile",
			})
		).toEqual({ isLot: false, rule: "title" });
		expect(
			classifyLot({
				productType: "Coffee",
				tags: [],
				title: "Decaf Ethiopia - Swiss Water Processed",
			}).isLot
		).toBe(true);
		expect(
			classifyLot({
				productType: "",
				tags: [],
				title: "Vancouver Mountain Water Decaf",
			}).isLot
		).toBe(true);
	});

	test("Passenger's Archival Release lots are lots (#31)", () => {
		expect(
			lot(
				"Archival Release",
				["Freezer Friday"],
				"Archival Release #62 - Valdeir Cezati - 2023"
			)
		).toBe(true);
		expect(
			lot(
				"Archival Release",
				["Freezer Friday"],
				"Archival Release #45 - Miguel Mears - Cup of Excellence - 2021"
			)
		).toBe(true);
		// Cup of Excellence rescues the ambiguous `cup` on its own too.
		expect(lot("", [], "Miguel Mears - Cup of Excellence")).toBe(true);
		expect(lot("", [], "Finca La Bella COE #7")).toBe(true);
		expect(lot("", [], "Gaharo Experiments Wet Process")).toBe(true);
	});

	test("Merit's Wholesale channel rows are wholesale (#31)", () => {
		expect(
			classifyLot({
				productType: "Coffee",
				tags: ["Normal Wholesale"],
				title: "Sugarcane Decaf",
				vendor: "Wholesale",
			})
		).toEqual({ isLot: false, rule: "wholesale" });
		expect(
			isWholesale("Coffee", ["Airport"], "Sugarcane Decaf", "Wholesale")
		).toBe(true);
		// Any other vendor says nothing: La Colombe cafes, Regalia origins,
		// Sightglass producers, Merit's own Ecommerce/Merit pair.
		expect(isWholesale("Coffee", [], "Sugarcane Decaf", "Ecommerce")).toBe(
			false
		);
		expect(isWholesale("Coffee", [], "Sugarcane Decaf", "Merit")).toBe(false);
		expect(isWholesale("Coffee", [], "Chiroso Lot 7", "Huila, Colombia")).toBe(
			false
		);
	});

	test("the four small leaks (#31)", () => {
		// Passenger collateral typed as such.
		expect(lot("Collateral", [], "Necessary Coffee Pot Tags")).toBe(false);
		// Ruby: untyped, a bare wholesale tag and nothing else.
		expect(lot("", ["Wholesale"], "Quick Release Seasonal Blend")).toBe(false);
		expect(lot("", ["Wholesale"], "Bradbury's Seasonal Blend")).toBe(false);
		// ...but with another tag, or a type, the bare tag still means "also sold wholesale".
		expect(lot("", ["Washed", "Wholesale"], "Ethiopia Reko")).toBe(true);
		expect(lot("Beans", ["wholesale"], "Ethiopia Halo")).toBe(true);
		// A lone hidden tag is NOT a marker: 165 Intelligentsia and 7 Counter
		// Culture coffees on the live feeds carry `Hidden` and nothing else.
		// Counter Culture's "12oz Year-Round Blends" landing product stays.
		expect(lot("Coffee", ["Hidden"], "Kenya Gatomboya")).toBe(true);
		expect(lot("Coffee", ["hidden"], "Pedro Patana")).toBe(true);
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

	test("decodes the punctuation entities shop themes emit, so a spec value stays whole", () => {
		expect(
			stripHtml(
				"<span>Chinacla&comma; La Paz</span><p>Ethiopia Halo &ndash; the country&rsquo;s best&hellip; &ldquo;wow&rdquo; &mdash; 1&minus;2</p>"
			)
		).toBe(
			"Chinacla, La Paz\nEthiopia Halo \u2013 the country\u2019s best\u2026 \u201Cwow\u201D \u2014 1\u22122"
		);
	});

	test("leaves an entity it does not know as typed", () => {
		expect(stripHtml("<p>1&frac12; kg &deg;C</p>")).toBe("1&frac12; kg &deg;C");
	});
});

const fromTags = (tags: string[]) => parseLotAttributes({ tags });

describe("parseLotAttributes", () => {
	test("reads the Proud Mary convention", () => {
		expect(
			fromTags(["Coffee", "For: Filter", "From: Ethiopia", "Process: Natural"])
		).toEqual({ origin: "Ethiopia", process: "Natural" });
	});

	test("reads the Intelligentsia convention", () => {
		expect(fromTags(["Country: Guatemala", "Roast Level: Bright"])).toEqual({
			origin: "Guatemala",
		});
	});

	test("keeps a Roast Level value only when it names an actual roast", () => {
		expect(fromTags(["Roast Level: Comforting"])).toEqual({});
		expect(fromTags(["Roast Profile: Bright"])).toEqual({});
		expect(fromTags(["profile:modern"])).toEqual({});
		expect(fromTags(["Roast: Light"])).toEqual({ roastLevel: "Light" });
		expect(fromTags(["Roast: Medium-Light"])).toEqual({
			roastLevel: "Medium-Light",
		});
		// Anchored: a roast word inside a taste phrase is not a roast level.
		expect(fromTags(["Roast: Lightly sweet & delightful"])).toEqual({});
	});

	test("takes a From: value only when it looks like a place", () => {
		expect(fromTags(["From: Colombia, Huila"])).toEqual({
			origin: "Colombia, Huila",
		});
		expect(fromTags(["From: our friends at the co-op"])).toEqual({});
		expect(fromTags(["From: 2024 harvest"])).toEqual({});
	});

	test("reads the Onyx convention and a bare process tag", () => {
		expect(fromTags(["origin:Ethiopia"])).toEqual({ origin: "Ethiopia" });
		expect(fromTags(["amazing", "Washed", "Wholesale"])).toEqual({
			process: "Washed",
		});
	});

	test("tolerates string tags and noise", () => {
		expect(fromTags([])).toEqual({});
		expect(fromTags(["nope", ":", "From:"])).toEqual({});
		expect(parseLotAttributes({ blockText: "", tags: [], title: "" })).toEqual(
			{}
		);
	});

	test("keeps every origin and process a keyed tag names", () => {
		// Proud Mary "Humbler Blend"; Intelligentsia "26.2 Blend 10 oz".
		expect(fromTags(["From: Brazil", "From: Honduras"])).toEqual({
			origin: "Brazil, Honduras",
		});
		expect(fromTags(["Country: Ethiopia", "Country: Guatemala"])).toEqual({
			origin: "Ethiopia, Guatemala",
		});
		expect(fromTags(["Process: Anaerobic", "Process: Washed"])).toEqual({
			process: "Anaerobic, Washed",
		});
		// The roaster's own process term stands even off the closed vocabulary.
		expect(fromTags(["Process: Culture-Innoculated Washed"])).toEqual({
			process: "Culture-Innoculated Washed",
		});
	});

	test("reads Counter Culture's key__value tags", () => {
		expect(
			fromTags([
				"coffee",
				"color__CF80A8",
				"origin__colombia",
				"origin__year-round-blend",
				"roastlevel__dark-roast",
			])
		).toEqual({ origin: "Colombia", roastLevel: "Dark Roast" });
		expect(fromTags(["roastlevel__medium-light-roast"])).toEqual({
			roastLevel: "Medium-Light Roast",
		});
	});

	test("reads a country, process or roast from a bare tag", () => {
		// Blossom "Mexico - Altura Veracruz - Natural".
		expect(
			parseLotAttributes({
				tags: [
					"Bottomless",
					"Coffee",
					"delicious coffee",
					"Light roast",
					"Mexico",
					"Natural",
					"specialty coffee",
				],
				title: "Mexico - Altura Veracruz - Natural",
			})
		).toEqual({
			origin: "Mexico",
			process: "Natural",
			roastLevel: "Light roast",
		});
		expect(fromTags(["El-Salvador"])).toEqual({ origin: "El Salvador" });
		expect(fromTags(["Natural Processed"])).toEqual({ process: "Natural" });
		expect(fromTags(["Medium Dark"])).toEqual({ roastLevel: "Medium Dark" });
		expect(fromTags(["Light Roast"])).toEqual({ roastLevel: "Light Roast" });
		expect(fromTags(["medium roast"])).toEqual({ roastLevel: "medium roast" });
		expect(fromTags(["lighter roast coffee", "roasted"])).toEqual({});
	});

	test("reads the title when no tag names the field", () => {
		expect(
			parseLotAttributes({
				tags: ["Blend Color: #ea7f7a", "Coffee Type: Single Origin"],
				title: "Kenya Karumandi",
			})
		).toEqual({ origin: "Kenya" });
		expect(
			parseLotAttributes({ tags: [], title: "2026 Demeka Becha - Ethiopia" })
		).toEqual({ origin: "Ethiopia" });
		expect(
			parseLotAttributes({
				tags: ["passenger-coffee", "Reserve Lot"],
				title: "Kerehaklu - Washed Process - 2026",
			})
		).toEqual({ process: "Washed" });
		expect(
			parseLotAttributes({
				tags: [],
				title: "LIMITED | HONDURAS | Benjamin Paz | Geisha | Anaerobic Washed",
			})
		).toEqual({ origin: "Honduras", process: "Anaerobic Washed" });
		expect(
			parseLotAttributes({ tags: [], title: "Las Lajas Black Honey" })
		).toEqual({ process: "Black Honey" });
		// A roast in the title needs the word roast: "Dark Chocolate Blend" is a note.
		expect(
			parseLotAttributes({ tags: [], title: "Big Trouble Medium Roast" })
		).toEqual({ roastLevel: "Medium Roast" });
		expect(
			parseLotAttributes({ tags: [], title: "Dark Chocolate Blend" })
		).toEqual({});
		// Adjectives and the coffee word alone name no country.
		expect(
			parseLotAttributes({ tags: [], title: "Brazilian Espresso" })
		).toEqual({});
	});

	test("a title names one origin: the country that opens or closes it", () => {
		// Intelligentsia: El Congo is the farm. Sey: Finca Costa Rica is the farm.
		expect(
			parseLotAttributes({ tags: [], title: "Costa Rica El Congo Geisha" })
		).toEqual({ origin: "Costa Rica" });
		expect(
			parseLotAttributes({
				tags: [],
				title: "2022 Faver Ninco; Finca Costa Rica - Colombia",
			})
		).toEqual({ origin: "Colombia" });
		expect(
			parseLotAttributes({ tags: [], title: "Guatemala Ethiopia Landrace" })
		).toEqual({ origin: "Guatemala" });
		// Bare tags on a blend are its components; all of them stay.
		expect(fromTags(["colombia", "Ethiopia", "Guatemala"])).toEqual({
			origin: "Colombia, Ethiopia, Guatemala",
		});
	});

	test("a roast tag with the word roast outranks a bare level", () => {
		// Blossom "Cold Brew Blend" carries both `dark` and `medium roast`.
		expect(fromTags(["dark", "medium roast"])).toEqual({
			roastLevel: "medium roast",
		});
		expect(fromTags(["dark", "dark roast", "medium roast"])).toEqual({
			roastLevel: "dark roast",
		});
	});

	test("a keyed tag outranks the title", () => {
		expect(
			parseLotAttributes({
				tags: ["From: Colombia"],
				title: "Ethiopia Halo",
			})
		).toEqual({ origin: "Colombia" });
	});

	test("reads Key: Value lines in the body", () => {
		// Heart "Ethiopia Halo".
		expect(
			parseLotAttributes({
				blockText:
					"Location: Gedeb\nElevation: 1900-2200m\nVarietals: Heirloom\nProcess: Fully washed\nFOB cost: $6.00lb",
				tags: ["culture", "Single Origin"],
				title: "Ethiopia Halo",
			})
		).toEqual({
			elevation: "1900-2200m",
			origin: "Ethiopia",
			process: "Fully washed",
			region: "Gedeb",
			variety: "Heirloom",
		});
		// La Colombe: a spaced colon, Sumatra read as Indonesia, every origin kept.
		expect(
			parseLotAttributes({
				blockText:
					"Origins : A seasonal blend of beans from Sumatra and Brazil\nRoast Level: Medium\nIngredient Detail\nOrigin : Brazil\nRegion : Cerrado Minas\nOrigin : Colombia",
				tags: [],
				title: "Fall Blend",
			})
		).toEqual({
			origin: "Indonesia, Brazil, Colombia",
			region: "Cerrado Minas",
			roastLevel: "Medium",
		});
		expect(
			parseLotAttributes({
				blockText: "Roast Level: Comforting\nrecommended use: Espresso",
				tags: [],
			})
		).toEqual({});
		// Ruby: the roast stands on its own line.
		expect(
			parseLotAttributes({
				blockText:
					"We Taste: lemon meringue - lavender\nMedium-light Roast\nDOWNLOAD info sheets",
				tags: ["amazing", "Washed"],
			})
		).toEqual({ process: "Washed", roastLevel: "Medium-light Roast" });
	});

	test("reads East Pole's all-caps table", () => {
		expect(
			parseLotAttributes({
				blockText:
					"PRODUCER\nAMOUNT\nIyenga FCS\n12 oz. bag\nORIGIN\nMbozi, Tanzania\nALTITUDE\n1,900 masl\nVARIETY\nBourbon\nPROCESS\nWashed\nNOTES\nBright acidity, brown sugar, papaya\nFounded in the wake of the Tanzanian Cooperative Act",
				tags: [],
				title: "Iyenga",
			})
		).toEqual({
			elevation: "1,900 masl",
			origin: "Tanzania",
			process: "Washed",
			variety: "Bourbon",
		});
	});

	test("reads the vendor for origin last", () => {
		expect(
			parseLotAttributes({
				tags: [],
				title: "El Jardin Chiroso Lot 7",
				vendor: "Huila, Colombia",
			})
		).toEqual({ origin: "Colombia" });
		expect(
			parseLotAttributes({
				tags: [],
				title: "Ethiopia Halo",
				vendor: "Huila, Colombia",
			})
		).toEqual({ origin: "Ethiopia" });
		expect(
			parseLotAttributes({ tags: [], vendor: "Heart Coffee Roasters" })
		).toEqual({});
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

	test("a prose 'we taste' that is not a list yields to the later lead-in", () => {
		expect(
			extractRoasterNotes(
				"Her Chiroso continues to be one of the most dynamic we taste each season. In the cup we find tropical fruit, ripe strawberry, and delicate florals.",
				[]
			)
		).toBe("tropical fruit, ripe strawberry, and delicate florals");
	});

	test("'we tasted' is not the 'we taste' lead-in", () => {
		expect(
			extractRoasterNotes(
				"We were so excited with what we tasted from this year's harvest that we sourced nine lots. In the cup we find black currant and cassis.",
				[]
			)
		).toBe("black currant and cassis");
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

	// A labelled line ("Tasting Notes: a, b, & c") is the roaster's own
	// structured field, so it wins over any descriptor prose that follows.
	// Proud Mary and PT's write every product this way; 320 of their 955
	// feed products carried one and none were read.
	test("reads a labelled Tasting Notes line (Proud Mary)", () => {
		expect(
			extractRoasterNotes(
				"Tasting Notes: Chocolate, floral, blackberry, peach, & winey\nProducer: Javier Fernandez\nFarm: Los Tanques\nVarietal: Catuai",
				[]
			)
		).toBe("Chocolate, floral, blackberry, peach, & winey");
	});

	test("a labelled Notes line wins over later notes-of prose (PT's)", () => {
		expect(
			extractRoasterNotes(
				"Region: Loja Province\nRoast: Light-Medium\nNotes: Black Cherry, Cocoa Powder, Kumquat\nThe Story\nWe found notes of kumquat, dragonfruit, and nutmeg in the cup, alongside black cherry acidity.",
				[]
			)
		).toBe("Black Cherry, Cocoa Powder, Kumquat");
	});

	test("a labelled line keeps a comma-free tail for the store boundary to drop", () => {
		expect(
			extractRoasterNotes(
				"Notes: Chocolate fudge, caramel, date, with a big syrupy body\nHumbler is a coffee made by the people, for the people!",
				[]
			)
		).toBe("Chocolate fudge, caramel, date, with a big syrupy body");
	});

	test("a labelled line that is prose stops at the sentence end", () => {
		expect(
			extractRoasterNotes(
				"Tasting Notes: Fragrance and aroma of cherry and bergamot orange. In the cup powerful floral and citrus notes to be expected from a washed geisha.",
				[]
			)
		).toBe("Fragrance and aroma of cherry and bergamot orange");
	});

	test("a labelled value on the next line (a <br> inside the label) is read", () => {
		expect(
			extractRoasterNotes(
				"Tasting Notes:\nMelon, tropical, milk chocolate, floral and complex\nProcessing: Natural Anaerobic 48hrs",
				[]
			)
		).toBe("Melon, tropical, milk chocolate, floral and complex");
	});

	test("the label must start its line and be a notes label", () => {
		// "Brewing notes:" is guidance, and an empty label carries nothing.
		expect(
			extractRoasterNotes("Brewing notes: 15g to 250g of water.", [])
		).toBeNull();
		expect(
			extractRoasterNotes("Notes:\nProducer: Hartmann Family", [])
		).toBeNull();
	});

	// A4: a same-line value keeps a colon inside it; the "next line is itself
	// a Label:" rule applies only when the value sits on the next line.
	test("a same-line labelled value keeps a colon inside a list item", () => {
		expect(
			extractRoasterNotes(
				"Notes: Milk chocolate, orange & caramel (12 oz: whole bean)",
				[]
			)
		).toBe("Milk chocolate, orange & caramel (12 oz: whole bean)");
	});

	test("a same-line value that opens with its own Label: is not the notes", () => {
		expect(extractRoasterNotes("Notes: Espresso: 1:2.5", [])).toBeNull();
	});

	test("a next-line value is read unless it is itself a label line", () => {
		expect(extractRoasterNotes("Tasting Notes:\nCherry, Cocoa", [])).toBe(
			"Cherry, Cocoa"
		);
		expect(
			extractRoasterNotes("Tasting Notes:\nProducer: Hartmann Family", [])
		).toBeNull();
	});

	test("a cupping score under a notes label is not a note", () => {
		expect(extractRoasterNotes("Cupping Notes: 86 points", [])).toBeNull();
	});

	// A5: "we find" opening a that/this/it clause is narrative, and a later
	// "notes of" list beats an earlier "we find" list.
	test("'we find that ...' prose is not a descriptor list", () => {
		expect(
			extractRoasterNotes(
				"Each season we find that this coffee, grown at 1900m, is a great choice for espresso.",
				[]
			)
		).toBeNull();
	});

	test("a 'notes of' list wins over an earlier 'we find' list", () => {
		expect(
			extractRoasterNotes(
				"Every year we find new lots, new friends and new stories in Huila. Expect notes of plum, cacao and jasmine.",
				[]
			)
		).toBe("plum, cacao and jasmine");
	});

	test("'we find' after a varied subject still reads the list (Sey)", () => {
		expect(
			extractRoasterNotes(
				"In this Red Gesha separation we find raspberry, lime and hibiscus.",
				[]
			)
		).toBe("raspberry, lime and hibiscus");
	});

	// Sey varies the lead-in per lot: "In this cup we find", "In this year's
	// cup we find", "In this Red Gesha separation we find". 42 of its 181
	// noteless lots on the live feed were this shape.
	test("'we find' with a list after it is a lead-in whatever precedes it (Sey)", () => {
		expect(
			extractRoasterNotes(
				"We look forward to visiting on our next trip to Huila. In this cup we find hibiscus, blueberry, and finger lime.",
				[]
			)
		).toBe("hibiscus, blueberry, and finger lime");
		expect(
			extractRoasterNotes(
				"In this year's cup we find lychee, mango, and orange.",
				[]
			)
		).toBe("lychee, mango, and orange");
	});

	test("'we find' without a list after it is prose", () => {
		expect(
			extractRoasterNotes(
				"Dwight continues to produce some of the best coffees we find anywhere in the world. This cup is remarkably complex.",
				[]
			)
		).toBeNull();
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

	// #29 A: the descriptor list's trailing clause rode along.
	test.each([
		[
			"Passenger",
			"With comforting flavors of bittersweet chocolate and graham cracker, this classic Dark Roast tastes great on its own or with the addition of cream and sugar.",
			"bittersweet chocolate and graham cracker",
		],
		[
			"Counter Culture",
			"With notes of dark chocolate, roasted nuts, and berries, Gradient is the perfect choice for coffee lovers who enjoy vibrant acidity.",
			"dark chocolate, roasted nuts, and berries",
		],
		[
			"Madcap",
			"With notes of molasses, silky sweetness, and a smooth finish, this is the coffee you reach for after hours.",
			"molasses, silky sweetness, and a smooth finish",
		],
		[
			"Blossom",
			"Expect notes of blackberry and strawberry , making it a perfect choice for a bright morning.",
			"blackberry and strawberry",
		],
		[
			"no conjunction",
			"Notes of prunes, fig danish, nutmeg , reflecting the rich character of the region.",
			"prunes, fig danish, nutmeg",
		],
		[
			"a list with a comma-free tail keeps every item",
			"In the cup we find peach, melon, red tea, and lovely florality.",
			"peach, melon, red tea, and lovely florality",
		],
		[
			"a bare and inside an item does not end the list (Sey)",
			"In the cup we find an intense and complex profile of blackberry lemonade, coffee blossom florals, and ripe nectarine.",
			"an intense and complex profile of blackberry lemonade, coffee blossom florals, and ripe nectarine",
		],
		[
			"a capitalised subject after the comma ends a bare-and list",
			"With notes of graham cracker and molasses, Even Keel is a smooth and satisfying coffee.",
			"graham cracker and molasses",
		],
		[
			"a two-adjective final item is not a clause seam",
			"In the cup we find dark fruits, pink grapefruit, and a rich, jam-like sweetness.",
			"dark fruits, pink grapefruit, and a rich, jam-like sweetness",
		],
		[
			"a capitalised item before the conjunction stays",
			"In the cup we find an intensely floral profile of jasmine and rose, Meyer lemon, and bergamot, with a slightly tropical finish.",
			"an intensely floral profile of jasmine and rose, Meyer lemon, and bergamot, with a slightly tropical finish",
		],
		[
			"a Title Case list with no conjunction stays whole",
			"Notes of Cherry, Chocolate, Almond.",
			"Cherry, Chocolate, Almond",
		],
		[
			"a lowercase continuation after a bare-and list stays",
			"Notes of dried apricot and honey, bolstered by a tea-like mouthfeel.",
			"dried apricot and honey, bolstered by a tea-like mouthfeel",
		],
	])("cuts the clause after the list: %s", (_label, text, expected) => {
		expect(extractRoasterNotes(text, [])).toBe(expected);
	});

	// #29 B: Blossom's "we taste" is prose, not Ruby's dash list.
	test("bounds a prose we-taste at the sentence and drops the emoji tail", () => {
		expect(
			extractRoasterNotes(
				stripHtml(
					'<p dir="ltr"><strong>We taste dark chocolate and stewed blueberries, a perfect balance of refreshing and sweet</strong><span>. 🌑</span></p>'
				),
				[]
			)
		).toBe(
			"dark chocolate and stewed blueberries, a perfect balance of refreshing and sweet"
		);
		expect(
			extractRoasterNotes(
				"We taste cocoa, cherry and toffee in a syrupy body. 🧊 Brew it cold.",
				[]
			)
		).toBe("cocoa, cherry and toffee in a syrupy body");
	});

	test("keeps the Ruby dash list intact past punctuation", () => {
		expect(
			extractRoasterNotes(
				"We Taste: Cherry Cola - Dried Fig - Brown Sugar - Cocoa Nib\nMedium-light Roast",
				[]
			)
		).toBe("Cherry Cola - Dried Fig - Brown Sugar - Cocoa Nib");
	});

	// #29 C: Merit opens with the notes as a bullet line.
	test("reads a leading bullet line before any lead-in", () => {
		expect(
			extractRoasterNotes(
				"Prunes • Fig Danish • Nutmeg\nKiamugumo Factory sits in the Ngariama community with notes of history everywhere.",
				[]
			)
		).toBe("Prunes • Fig Danish • Nutmeg");
		expect(
			extractRoasterNotes(
				stripHtml(
					'<p style="text-align: center;">Strawberry • Vanilla Bean • Clove</p>\n<p>Even with our decaf offering, we take flavor seriously.</p>'
				),
				[]
			)
		).toBe("Strawberry • Vanilla Bean • Clove");
		expect(
			extractRoasterNotes(
				"Raspberry • Lassi • Rose • Blood Orange\nLa Senda.",
				[]
			)
		).toBe("Raspberry • Lassi • Rose • Blood Orange");
	});

	test("a bullet line of long items or only two is not a notes list", () => {
		expect(
			extractRoasterNotes(
				"Free shipping on orders over $40 • Roasted to order every Monday • Ships fast\nA blend.",
				[]
			)
		).toBeNull();
		// Two items is as likely an origin line ("Ethiopia • Guji") as notes.
		expect(
			extractRoasterNotes("Ethiopia • Guji\nA lovely coffee.", [])
		).toBeNull();
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
				productType: "Coffee",
				roasterNotes: ["peach", "melon", "red tea"],
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
			lotCopy: { productType: "Coffee" },
			name: "Lot 2",
			variants: expect.anything(),
		});
		expect(page.products[1]?.lotCopy).toStrictEqual({ productType: "Coffee" });
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

	test("reads attributes from the title, body and vendor (#30)", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(6, {
					body_html: "<p>Location: Gedeb</p><p>Process: Fully washed</p>",
					tags: ["Single Origin"],
					title: "Ethiopia Halo",
				}),
				feedProduct(7, {
					body_html: "",
					tags: ["Coffee"],
					title: "El Jardin Chiroso Lot 7",
					vendor: "Huila, Colombia",
				}),
			])
		);
		expect(page.products[0]?.lotCopy).toMatchObject({
			origin: "Ethiopia",
			process: "Fully washed",
		});
		expect(page.products[1]?.lotCopy).toMatchObject({ origin: "Colombia" });
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

const feedResponse = (status: number, text: string | null = null) =>
	Promise.resolve({ status, text });

describe("fetchFirstFeedPage", () => {
	test("returns the apex page when it answers", async () => {
		const fetchPage = vi.fn(() =>
			feedResponse(200, feedBody([feedProduct(1)]))
		);
		const result = await fetchFirstFeedPage({
			fetchPage,
			websiteUrl: "https://drinkpassenger.com",
		});
		expect(fetchPage).toHaveBeenCalledTimes(1);
		expect(result.websiteUrl).toBe("https://drinkpassenger.com");
		expect(result.text).toContain('"products"');
	});

	test("retries on www. after an apex 404 and reports the host that worked", async () => {
		const fetchPage = vi.fn((url: string) =>
			url.startsWith("https://www.")
				? feedResponse(200, feedBody([feedProduct(1)]))
				: feedResponse(404)
		);
		const result = await fetchFirstFeedPage({
			fetchPage,
			websiteUrl: "https://drinkpassenger.com",
		});
		expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([
			shopifyProductsUrl("https://drinkpassenger.com"),
			shopifyProductsUrl("https://www.drinkpassenger.com"),
		]);
		expect(result.websiteUrl).toBe("https://www.drinkpassenger.com");
		expect(result.text).toContain('"products"');
	});

	test("does not retry when the host already has www. or the failure is not a 404", async () => {
		const www = vi.fn(() => feedResponse(404));
		const first = await fetchFirstFeedPage({
			fetchPage: www,
			websiteUrl: "https://www.example.com",
		});
		expect(www).toHaveBeenCalledTimes(1);
		expect(first).toEqual({
			text: null,
			websiteUrl: "https://www.example.com",
		});

		const blocked = vi.fn(() => feedResponse(403));
		const second = await fetchFirstFeedPage({
			fetchPage: blocked,
			websiteUrl: "https://example.com",
		});
		expect(blocked).toHaveBeenCalledTimes(1);
		expect(second).toEqual({ text: null, websiteUrl: "https://example.com" });
	});

	test("keeps the apex when the www. retry fails too", async () => {
		const fetchPage = vi.fn(() => feedResponse(404));
		const result = await fetchFirstFeedPage({
			fetchPage,
			websiteUrl: "https://example.com",
		});
		expect(fetchPage).toHaveBeenCalledTimes(2);
		expect(result).toEqual({ text: null, websiteUrl: "https://example.com" });
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
			shadowCandidates: [],
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
			shadowCandidates: [],
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

describe("pageFactCandidates (ADR-0005)", () => {
	// Merit "Ojo de Agua" and Sey "Huila Decaffeinated" as the determinism
	// runs returned them (audit §4), on a page that says what they say.
	const markdown = [
		"# Ojo de Agua",
		"Process: Washed",
		"Cultivar: Caturra, Colombia",
		"Altitude: 1500-1730masl",
		"Region: Huila",
		"Producer: Finca Ojo de Agua",
		"Recommended use: Espresso",
		"Roast: Ultra Light",
		"Prunes • Fig Danish • Nutmeg",
		"Hand-picked at peak ripeness. Floated to remove defects, then fully washed and dried on raised beds over three weeks.",
	].join("\n\n");

	test("label lines, vocabulary spans and bare note lists become candidates", () => {
		expect(pageFactCandidates(markdown)).toEqual({
			elevation: ["1500-1730masl"],
			process: ["Washed", "fully washed"],
			producer: ["Finca Ojo de Agua"],
			region: ["Huila"],
			roastLevel: [],
			tastingNotes: ["Prunes", "Fig Danish", "Nutmeg"],
			variety: ["Caturra", "Caturra, Colombia"],
		});
	});

	test("a roast label only yields a candidate when the value is a level", () => {
		expect(pageFactCandidates("Roast: Ultra Light").roastLevel).toEqual([]);
		expect(pageFactCandidates("Roast Level: Medium-Light").roastLevel).toEqual([
			"Medium-Light",
		]);
		expect(
			pageFactCandidates("a bright light roast for filter").roastLevel
		).toEqual(["light roast"]);
	});

	test("table rows, next-line values and a country under region", () => {
		const tabled = [
			"| Process | Washed | 250g |",
			"Producer",
			"Finca Ojo de Agua",
			"Origin: Colombia",
		].join("\n");
		const candidates = pageFactCandidates(tabled);
		expect(candidates.process).toEqual(["Washed"]);
		expect(candidates.producer).toEqual(["Finca Ojo de Agua"]);
		// "Colombia" is a country: it is an origin, not a region candidate.
		expect(candidates.region).toEqual([]);
	});

	test("variety prose is found by the vocabulary, elevation by its span", () => {
		const candidates = pageFactCandidates(
			"A washed SL28 and SL34 blend grown at 1,900 - 2,100 masl."
		);
		expect(candidates.variety).toEqual(["SL28", "SL34"]);
		expect(candidates.elevation).toEqual(["1,900 - 2,100 masl"]);
	});
});

describe("verifyPageFacts (ADR-0005)", () => {
	// Merit "Ojo de Agua" and Sey "Huila Decaffeinated" as the determinism
	// runs returned them (audit §4): the picks Jev returns over that page.
	test("picks pass their field's shape into the stored facts", () => {
		expect(
			verifyPageFacts({
				elevation: "1500-1730masl",
				process: "Washed",
				producer: "Finca Ojo de Agua",
				region: "Huila",
				roastLevel: "Espresso",
				tastingNotes: ["Prunes", "Fig Danish", "Nutmeg"],
				variety: "Caturra, Colombia",
			})
		).toEqual({
			elevation: "1500-1730masl",
			process: "Washed",
			producer: "Finca Ojo de Agua",
			region: "Huila",
			tastingNotes: ["Prunes", "Fig Danish", "Nutmeg"],
			variety: "Caturra, Colombia",
		});
	});

	test("wrong-field picks still fail: Espresso is not a roast, Ultra Light is not a level", () => {
		expect(verifyPageFacts({ roastLevel: "Espresso" })).toEqual({});
		expect(verifyPageFacts({ roastLevel: "Ultra Light" })).toEqual({});
		expect(verifyPageFacts({ roastLevel: "Light" })).toEqual({
			roastLevel: "Light",
		});
	});

	test("a paragraph pick yields only the process terms it names", () => {
		expect(
			verifyPageFacts({
				process:
					"Hand-picked at peak ripeness. Floated to remove defects, then fully washed and dried on raised beds over three weeks.",
			})
		).toEqual({ process: "fully washed" });
	});

	test("placeholders, prose and a country under region are dropped", () => {
		expect(
			verifyPageFacts({
				elevation: "Not specified",
				producer: "the Ojo de Agua farm",
				region: "Colombia",
				variety: "Caturra",
			})
		).toEqual({ variety: "Caturra" });
		expect(verifyPageFacts({})).toEqual({});
	});

	test("a note's lead-in is stripped", () => {
		expect(verifyPageFacts({ tastingNotes: ["Notes of Cherry"] })).toEqual({
			tastingNotes: ["Cherry"],
		});
	});
});

describe("pageTextFromHtml", () => {
	// Real theme markup (ADR-0008): Onyx renders one span per note, Counter
	// Culture a pipe-separated line, Stumptown a div per note. None is a
	// list the line rules read, and nav lines fill the candidate cap first.
	const chrome =
		"<header><nav><a>Coffee</a> | <a>Holiday</a> | <a>Subscription</a></nav></header>" +
		"<div>Free shipping on $30 and up!</div><div>Subscribe | Save | Gift Guide</div>";
	const story =
		"<p>Fredy Perez is a longtime producer in San Andrés, Lempira, and one of the people who first helped us find our footing in this relatively young coffee-producing region. Since beginning our work here around 2021, Fredy has become both a trusted producer and an important local connection.</p>";

	test("a theme's tasting-notes element leads the note candidates (Onyx spans)", () => {
		const text = pageTextFromHtml(
			`<html><body>${chrome}<main><h1>Honduras Fredy Perez</h1><p class="tasting-notes kapra"><span class="note">Tart Apple</span><span class="note">Pecan</span><span class="note">Fig</span><span class="note">Allspice</span></p>${story}</main></body></html>`
		);
		expect(text).not.toBeNull();
		expect(pageFactCandidates(text ?? "").tastingNotes.slice(0, 4)).toEqual([
			"Tart Apple",
			"Pecan",
			"Fig",
			"Allspice",
		]);
	});

	// ADR-0009: Verve's page text carries no notes; its product image alt
	// does, as a dash-joined spec line. Only the `Label: value` segments
	// become lines; the marketing segments and the menu images' alts do not.
	test("labelled image alt segments lead the candidates (Verve); unlabelled segments never become notes (ADR-0009)", () => {
		const text = pageTextFromHtml(
			`<html><body>${chrome}<main><div class="grid"><img src="/menu.png" alt="Verve Coffee Roasters - Menu - Best Sellers - Sermon, Streetlevel, Vancouver, Seabright Coffees"><img src="/silo.png" alt="Verve Coffee Roasters - Jose Martinez - 12oz - Single Origin - Huila, Colombia - Process: Washed - Variety: Pink Bourbon - Tasting Notes: Pear, Nectarine, Brown Sugar - Layered Elegance - Latin America - Seasonal - Direct Trade - Light Roast - Whole Bean Coffee"><img src='/scent.png' alt='Verve Coffee Roasters - Jose Martinez - Scent Profile - Process: Washed - Variety: Pink Bourbon - Tasting Notes: Pear, Nectarine, Brown Sugar - Light + Adventurous'></div><h1>Colombia José Martínez</h1>${story}</main></body></html>`
		);
		expect(text?.split("\n").slice(0, 3)).toEqual([
			"Process: Washed",
			"Variety: Pink Bourbon",
			"Tasting Notes: Pear, Nectarine, Brown Sugar",
		]);
		expect(text).not.toContain("Layered Elegance");
		expect(text).not.toContain("Streetlevel");
		const candidates = pageFactCandidates(text ?? "");
		expect(candidates.tastingNotes.slice(0, 3)).toEqual([
			"Pear",
			"Nectarine",
			"Brown Sugar",
		]);
		expect(candidates.process).toContain("Washed");
		expect(candidates.variety).toContain("Pink Bourbon");
	});

	test("an image alt inside an upsell block is another coffee's and is never read; the theme-notes line still comes first (ADR-0009)", () => {
		const text = pageTextFromHtml(
			`<html><body>${chrome}<main><div class="tasting-notes"><span class="note">Tart Apple</span><span class="note">Pecan</span></div><img alt="Honduras Fredy Perez - Roast: Light - Elevation: 1,650 masl" src="/bag.png">${story}<section class="related-products"><img alt="Kenya Karumandi - Tasting Notes: Red Currant, Blackberry" src="/other.png"></section></main></body></html>`
		);
		expect(text?.split("\n").slice(0, 3)).toEqual([
			"Tasting notes: Tart Apple, Pecan",
			"Roast: Light",
			"Elevation: 1,650 masl",
		]);
		expect(text).not.toContain("Red Currant");
	});

	test("a pipe-separated notes wrapper (Counter Culture) and a per-note div block (Stumptown)", () => {
		const counterCulture = pageTextFromHtml(
			`<html><body>${chrome}<div class="tasting-notes--wrapper flex"><p class="italic">tropical | brown sugar | juicy</p><button title="Toggle Taste Notes">?</button></div>${story}</body></html>`
		);
		expect(
			pageFactCandidates(counterCulture ?? "").tastingNotes.slice(0, 3)
		).toEqual(["tropical", "brown sugar", "juicy"]);
		const stumptown = pageTextFromHtml(
			`<html><body>${chrome}<div class="product-flavor-profile__tasting-notes"><h3 class="product-flavor-profile__tasting-notes-title">Tasting Notes</h3><div class="product-flavor-profile__flavors"><div class="product-flavor-profile__flavor">Red Currant</div><div class="product-flavor-profile__flavor">Cocoa</div><div class="product-flavor-profile__flavor">Honey</div></div></div>${story}</body></html>`
		);
		expect(
			pageFactCandidates(stumptown ?? "").tastingNotes.slice(0, 3)
		).toEqual(["Red Currant", "Cocoa", "Honey"]);
	});

	test("a script shell is null; chrome never reaches the text", () => {
		expect(
			pageTextFromHtml(
				"<html><body><div id='app'></div><script>render()</script></body></html>"
			)
		).toBeNull();
		const text = pageTextFromHtml(
			`<html><body>${chrome}<main>${story}</main><footer>Terms | Privacy</footer></body></html>`
		);
		expect(text).not.toContain("Holiday");
		expect(text).not.toContain("Privacy");
	});

	// A1: six ordinary notes run past the 80-character fact cap; the
	// labelled notes line has its own cap and still leads the candidates.
	test("a six-note theme element leads the candidates whole (A1)", () => {
		const text = pageTextFromHtml(
			`<html><body>${chrome}<main id="MainContent"><h1>Colombia El Diviso</h1><div class="tasting-notes"><span class="note">Blueberry Muffin</span><span class="note">Milk Chocolate</span><span class="note">Candied Orange Peel</span><span class="note">Brown Sugar</span><span class="note">Vanilla Bean</span><span class="note">Toasted Hazelnut</span></div>${story}</main></body></html>`
		);
		expect(pageFactCandidates(text ?? "").tastingNotes.slice(0, 6)).toEqual([
			"Blueberry Muffin",
			"Milk Chocolate",
			"Candied Orange Peel",
			"Brown Sugar",
			"Vanilla Bean",
			"Toasted Hazelnut",
		]);
	});

	test("a labelled notes line longer than the fact cap is still split into notes (A1)", () => {
		const candidates = pageFactCandidates(
			"Tasting notes: Blueberry Muffin, Milk Chocolate, Candied Orange Peel, Brown Sugar, Vanilla Bean, Toasted Hazelnut\nRoast: Light"
		);
		expect(candidates.tastingNotes).toEqual([
			"Blueberry Muffin",
			"Milk Chocolate",
			"Candied Orange Peel",
			"Brown Sugar",
			"Vanilla Bean",
			"Toasted Hazelnut",
		]);
	});

	// A2: another product's block is cut before the notes scan and before
	// the text is read, ancestors included.
	const upsell =
		'<section class="related-products"><h2>You may also like</h2><div class="card"><a>Kenya Gatomboya</a><span class="tasting-notes"><span>Blackcurrant</span><span>Tomato Leaf</span></span></div></section>';

	test("a notes element inside a related-products section is not this coffee's (A2)", () => {
		const html = `<html><body>${chrome}<main>${story}${upsell}</main></body></html>`;
		expect(themeNotesFromHtml(html)).toEqual([]);
		const text = pageTextFromHtml(html);
		expect(text).not.toBeNull();
		expect(text).not.toContain("Blackcurrant");
		expect(text).not.toContain("Kenya Gatomboya");
		expect(text).toContain("Fredy Perez");
	});

	test("an upsell ancestor marked by id alone is cut too (A2)", () => {
		const html = `<html><body>${chrome}<main>${story}<div id="related-products"><div><p class="tasting-notes">Jasmine, Lemon</p></div></div></main></body></html>`;
		expect(themeNotesFromHtml(html)).toEqual([]);
		expect(pageTextFromHtml(html)).not.toContain("Jasmine");
	});

	test("a featured-products grid is another product's block too (Sweet Bloom)", () => {
		// Sweet Bloom's product page ends in a featured-products grid whose
		// cards carry each blend's notes as a bare list, which the bare-list
		// route read as this coffee's until the section was cut.
		const html = `<html><body>${chrome}<main>${story}<div class="shopify-section"><section class="featured-products-grid"><div class="featured-products-grid__grid"><card-product class="card-product "><div class="card-product__title"><a href="/products/migration">Migration 9.2</a></div><span>Blend</span><em>jasmine, red grape, mango</em></card-product></div></section></div></main></body></html>`;
		const text = pageTextFromHtml(html) ?? "";
		expect(text).not.toContain("jasmine");
		expect(pageFactCandidates(text).tastingNotes).not.toContain("red grape");
	});

	test("the real notes element before an upsell section still leads (A2)", () => {
		const text = pageTextFromHtml(
			`<html><body>${chrome}<main><p class="tasting-notes"><span>Tart Apple</span><span>Pecan</span></p>${story}${upsell}</main></body></html>`
		);
		expect(text?.startsWith("Tasting notes: Tart Apple, Pecan")).toBe(true);
		expect(text).not.toContain("Blackcurrant");
	});

	// A3: the text is main's when the page has one; a mega-menu in divs
	// outside it never reaches the window.
	const megaMenu = `<div class="mega-menu" role="navigation"><div>Coffee</div>${"<div><a>Ethiopia Guji Natural</a> Notes of peach, bergamot and honey</div>".repeat(20)}</div>`;

	test("main is read instead of the whole document when the page has one (A3)", () => {
		const text = pageTextFromHtml(
			`<html><body>${chrome}${megaMenu}<div class="drawer">${"Nothing but menu copy that runs on and on. ".repeat(10)}</div><main id="MainContent">${story}</main><div role="dialog">Added to cart</div></body></html>`
		);
		expect(text).not.toBeNull();
		expect(text).toContain("Fredy Perez");
		expect(text).not.toContain("Ethiopia Guji Natural");
		expect(text).not.toContain("menu copy");
		expect(text).not.toContain("Added to cart");
	});

	test("the whole document is read when there is no main (A3)", () => {
		const text = pageTextFromHtml(
			`<html><body>${chrome}<div class="product">${story}</div></body></html>`
		);
		expect(text).toContain("Fredy Perez");
	});

	test("the whole document is read when main is a shell (A3)", () => {
		const text = pageTextFromHtml(
			`<html><body>${chrome}<main id="MainContent"><div id="app"></div></main><div class="product">${story}</div></body></html>`
		);
		expect(text).toContain("Fredy Perez");
	});

	test("template, noscript, svg and role dialog or navigation elements are dropped (A3)", () => {
		const text = pageTextFromHtml(
			`<html><body><template><p>Template copy</p></template><noscript>Enable JavaScript</noscript><svg><title>Icon title</title></svg><div role="navigation"><a>Menu link</a></div><div role="dialog"><p>Dialog copy</p></div>${story}</body></html>`
		);
		expect(text).toContain("Fredy Perez");
		for (const dropped of [
			"Template copy",
			"Enable JavaScript",
			"Icon title",
			"Menu link",
			"Dialog copy",
		]) {
			expect(text).not.toContain(dropped);
		}
	});

	// A8: class tokens, not substrings, and either quote style.
	test("a grid-layout notes class is a notes element and 'discard' is not an upsell class (A8)", () => {
		expect(
			themeNotesFromHtml(
				'<div class="product-grid__tasting-notes"><span>Cherry</span><span>Cocoa</span></div>'
			)
		).toEqual(["Cherry", "Cocoa"]);
		expect(
			themeNotesFromHtml(
				'<div class="discard tasting-notes"><span>Cherry</span><span>Cocoa</span></div>'
			)
		).toEqual(["Cherry", "Cocoa"]);
		expect(
			themeNotesFromHtml(
				'<div class="card tasting-notes"><span>Cherry</span><span>Cocoa</span></div>'
			)
		).toEqual([]);
	});

	test("a single-quoted class attribute is found (A8)", () => {
		expect(
			themeNotesFromHtml(
				"<div class='tasting-notes'><span>Cherry</span><span>Cocoa</span></div>"
			)
		).toEqual(["Cherry", "Cocoa"]);
	});
});
