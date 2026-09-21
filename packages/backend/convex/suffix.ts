// The one numeric-suffix rule (ADR-0011) for user handles, roaster slugs and
// lot handles: the base when free, otherwise the first free `base-2`,
// `base-3`, ... Callers bring the taken names from one indexed range scan
// over `base` and the `base-<digits>` names, bounded by SUFFIX_SCAN_LIMIT.

/**
 * Rows one suffix scan may read. Nothing in the catalog comes near it (the
 * biggest family is a few `taster-<n>` sign-ins), and a scan that fills it
 * cannot prove the next suffix free, so the claim fails instead of handing
 * out a duplicate.
 */
export const SUFFIX_SCAN_LIMIT = 1000;

/**
 * The exclusive upper bound of the index range that holds `base` and every
 * `base-<digits>`: ":" is the character after "9", so `base-2`, `base-10`
 * and `base` itself sort below it while `base-jr-2` and `basel` do not.
 * Pair with `.gte(base)`.
 */
export const suffixRangeEnd = (base: string): string => `${base}-:`;

/** Throw when a suffix scan filled its bound; see SUFFIX_SCAN_LIMIT. */
export const assertSuffixScanBounded = (
	rows: readonly unknown[],
	base: string
): void => {
	if (rows.length >= SUFFIX_SCAN_LIMIT) {
		throw new Error(
			`Too many names near "${base}" to claim a free suffix (${SUFFIX_SCAN_LIMIT} read)`
		);
	}
};

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
