// The one numeric-suffix rule (ADR-0011) for user handles, roaster slugs and
// lot handles: the base when free, otherwise the first free `base-2`,
// `base-3`, ... Callers bring the taken names from one indexed range scan
// over everything starting at `base`.

const escapeRegExp = (value: string): string =>
	value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * The first free name in `base`, `base-2`, `base-3`, ... given the names
 * already taken. Only names of the exact shape `base-<digits>` count as
 * used suffixes: `ada-lovelace-2` is a suffix of `ada-lovelace`, but
 * `ada-lovelace-jr-2` is not. `blocked` forces a suffix even when the base
 * itself is not taken (a reserved route name, or a caller that wants the
 * numbered form regardless).
 */
export const nextFreeSuffix = (
	base: string,
	taken: Iterable<string>,
	blocked = false
): string => {
	const names = new Set(taken);
	if (!(names.has(base) || blocked)) {
		return base;
	}
	const suffix = new RegExp(`^${escapeRegExp(base)}-(?<num>\\d+)$`, "u");
	const used = new Set(
		[...names].flatMap((name) => {
			const hit = suffix.exec(name);
			return hit === null ? [] : [Math.trunc(Number(hit.groups?.num))];
		})
	);
	let n = 2;
	while (used.has(n)) {
		n += 1;
	}
	return `${base}-${n}`;
};
