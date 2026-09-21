/**
 * The Find my next bag pane's open state lives in one root search param
 * (`?bag=true`) so a link can open it on any page and the back button closes
 * it. Every route inherits the root's search schema, so `bag` is typed
 * everywhere without each route declaring it.
 */
export interface NextBagSearch {
	bag?: true;
}

export const validateNextBagSearch = (
	search: Record<string, unknown>
): NextBagSearch => (search.bag === true ? { bag: true } : {});

/** The search update that opens the pane on the current page. */
export const openNextBag = <T extends object>(prev: T): T & NextBagSearch => ({
	...prev,
	bag: true,
});

/** The search update that closes it, leaving other params alone. */
export const closeNextBag = <T extends NextBagSearch>(
	prev: T
): Omit<T, "bag"> => {
	const { bag: _bag, ...rest } = prev;
	return rest;
};
