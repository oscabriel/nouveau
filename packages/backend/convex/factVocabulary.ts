// The closed vocabularies the page read asks Jev to choose from (ADR-0010,
// amended 2026-09-21). The verbatim pick ("Washed & Natural", "1,900 masl")
// stays the display value; the canonical enum is what filters, search and
// the recommendation prompt can rely on. Pure data, no Convex imports, so a
// client can import the option lists and labels.
//
// Every criteria map ends in `not_stated`, which is never stored: it means
// leave the field unset. Option keys are lower-case snake_case so a key can
// travel as a URL parameter unchanged.

/** The producing countries a roaster names, as option keys. */
export const ORIGIN_COUNTRIES = [
	"ethiopia",
	"kenya",
	"rwanda",
	"burundi",
	"uganda",
	"tanzania",
	"congo",
	"colombia",
	"brazil",
	"peru",
	"ecuador",
	"bolivia",
	"guatemala",
	"el_salvador",
	"honduras",
	"nicaragua",
	"costa_rica",
	"panama",
	"mexico",
	"indonesia",
	"papua_new_guinea",
	"yemen",
	"india",
	"china",
	"vietnam",
	"thailand",
	"myanmar",
] as const;

/** `originCountry`: a country, another country, a blend across countries. */
export const ORIGIN_COUNTRY_OPTIONS = [
	...ORIGIN_COUNTRIES,
	"other_country",
	"blend",
] as const;
export type OriginCountry = (typeof ORIGIN_COUNTRY_OPTIONS)[number];

export const PROCESS_FAMILY_OPTIONS = [
	"washed",
	"natural",
	"honey",
	"anaerobic_or_experimental",
	"wet_hulled",
	"mixed",
	"other",
] as const;
export type ProcessFamily = (typeof PROCESS_FAMILY_OPTIONS)[number];

export const ROAST_LEVEL_BAND_OPTIONS = [
	"light",
	"medium_light",
	"medium",
	"medium_dark",
	"dark",
] as const;
export type RoastLevelBand = (typeof ROAST_LEVEL_BAND_OPTIONS)[number];

export const ALTITUDE_BAND_OPTIONS = [
	"below_1000",
	"from_1000_to_1400",
	"from_1400_to_1800",
	"from_1800_to_2200",
	"above_2200",
] as const;
export type AltitudeBand = (typeof ALTITUDE_BAND_OPTIONS)[number];

/** The hatch on every vocabulary Choice; never stored. */
export const NOT_STATED = "not_stated";

/** The canonical fields, in the order the page read asks them. */
export const CANONICAL_FIELDS = [
	"altitudeBand",
	"originCountry",
	"processFamily",
	"roastLevelBand",
] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/** One vocabulary Choice: the field it fills, the question, one line per option. */
export interface VocabularyChoice {
	/** Option key to its one-line description; `not_stated` last. */
	criteria: Record<string, string>;
	id: CanonicalField;
	/** The question, with %COFFEE% where the read names the lot. */
	instructions: string;
	/** The option keys the field may store: every key but `not_stated`. */
	options: readonly string[];
}

/** "papua_new_guinea" as "Papua New Guinea", "el_salvador" as "El Salvador". */
export const optionLabel = (key: string): string =>
	key
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");

const NOT_STATED_LINE = "The page does not state this about this coffee.";

const vocabularyChoice = (
	id: CanonicalField,
	instructions: string,
	options: readonly string[],
	descriptions: Record<string, string>
): VocabularyChoice => ({
	criteria: {
		...Object.fromEntries(
			options.map((key) => [key, descriptions[key] ?? optionLabel(key)])
		),
		[NOT_STATED]: descriptions[NOT_STATED] ?? NOT_STATED_LINE,
	},
	id,
	instructions,
	options,
});

/**
 * The four vocabulary Choices the page read sends beside its line picks.
 * Form, decaf and lot type are the feed classifier's (extraction.classifyLot);
 * variety's long tail makes a fixed list lose more than it gains, so the
 * verbatim pick plus verifyVariety stays the tool there.
 */
export const VOCABULARY_CHOICES: readonly VocabularyChoice[] = [
	vocabularyChoice(
		"originCountry",
		"Which country was %COFFEE% grown in? A region, town or farm that belongs to one country (Yirgacheffe, Huila, Nyeri, Antigua) states that country. Choose blend when the coffee is a blend of several countries.",
		ORIGIN_COUNTRY_OPTIONS,
		{
			blend: "A blend of coffees from more than one country.",
			[NOT_STATED]:
				"No country, and no region that implies one, is stated for this coffee.",
			other_country: "A producing country not in this list.",
		}
	),
	vocabularyChoice(
		"processFamily",
		"How was %COFFEE% processed, as the page states it?",
		PROCESS_FAMILY_OPTIONS,
		{
			anaerobic_or_experimental:
				"Anaerobic, carbonic maceration, thermal shock, yeast or co-fermentation, or another experimental fermentation.",
			honey:
				"Honey, red, black or yellow honey, pulped natural, or semi-washed.",
			mixed: "A blend with more than one process.",
			natural: "Natural, dry-processed, or sun-dried in cherry.",
			[NOT_STATED]: "The process is not stated anywhere on the page.",
			other: "Another named process.",
			washed: "Washed, wet-processed, fully washed, or dry washed.",
			wet_hulled: "Wet-hulled or giling basah.",
		}
	),
	vocabularyChoice(
		"roastLevelBand",
		"What roast level does the roaster state for %COFFEE%?",
		ROAST_LEVEL_BAND_OPTIONS,
		{
			dark: "Dark, French, Italian, or an espresso-style dark roast.",
			light: "Light, filter, or Nordic roast.",
			medium: "Medium.",
			medium_dark: "Medium-dark.",
			medium_light: "Medium-light.",
			[NOT_STATED]: "The roast level is not stated anywhere on the page.",
		}
	),
	vocabularyChoice(
		"altitudeBand",
		"At what altitude was %COFFEE% grown, in meters above sea level? Convert feet to meters when the page gives feet.",
		ALTITUDE_BAND_OPTIONS,
		{
			above_2200: "2,200 masl or higher.",
			below_1000: "Below 1,000 masl.",
			from_1000_to_1400: "1,000 to 1,399 masl.",
			from_1400_to_1800: "1,400 to 1,799 masl.",
			from_1800_to_2200: "1,800 to 2,199 masl.",
			[NOT_STATED]: "No altitude or elevation is stated for this coffee.",
		}
	),
];
