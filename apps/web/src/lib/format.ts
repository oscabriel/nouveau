/** Formatting helpers shared by the feed and watch surfaces. */

export const formatPrice = (cents: number): string => {
	const dollars = cents / 100;
	return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
};

/**
 * Shopify names the only variant of a single-variant product "Default Title".
 * That's a placeholder, not a bag size; render nothing for it.
 */
export const displayVariantName = (name: string | null): string | null => {
	if (name === null) {
		return null;
	}
	const trimmed = name.trim();
	return trimmed === "" || trimmed === "Default Title" || trimmed === "Default"
		? null
		: trimmed;
};

/** A $0 price is a subscription or placeholder, not a deal; hide it. */
export const displayPriceCents = (cents: number | null): number | null =>
	cents === null || cents <= 0 ? null : cents;

export const relativeTime = (timestamp: number): string => {
	const seconds = Math.round((Date.now() - timestamp) / 1000);
	if (seconds < 60) {
		return "just now";
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `${minutes} min ago`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const days = Math.round(hours / 24);
	if (days < 30) {
		return `${days}d ago`;
	}
	return new Date(timestamp).toLocaleDateString();
};
