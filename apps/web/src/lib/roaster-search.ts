/** A roaster row as far as directory search cares. */
export interface SearchableRoaster {
	city: string;
	name: string;
	state: string;
}

const normalize = (value: string): string =>
	value
		.normalize("NFD")
		.replaceAll(/\p{Diacritic}/gu, "")
		.toLowerCase();

/**
 * Does this roaster match a directory search? Case and accent insensitive
 * over name, city and state; every whitespace-separated term must hit
 * somewhere, so "portland or" narrows to Oregon and "sey" finds Sey.
 * An empty search matches everything.
 */
export const matchesRoaster = (
	roaster: SearchableRoaster,
	search: string
): boolean => {
	const terms = normalize(search).split(/\s+/u).filter(Boolean);
	if (terms.length === 0) {
		return true;
	}
	const haystack = normalize(
		`${roaster.name} ${roaster.city} ${roaster.state}`
	);
	return terms.every((term) => haystack.includes(term));
};
