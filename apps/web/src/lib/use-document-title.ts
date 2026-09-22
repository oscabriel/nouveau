import { useEffect } from "react";

/**
 * Sets the tab title from data the page reads live, for the routes whose
 * title is a name from the database (roaster, lot, taster). Static pages set
 * theirs through the route's `head`, which `HeadContent` renders as a keyed
 * `<title>`; a dynamic route keeps a static `head` fallback too, so every
 * route change swaps that element and this effect writes over it once the
 * query resolves. There is no restore on cleanup: it would run after the
 * next route's `<title>` landed and overwrite it.
 */
export const useDocumentTitle = (title: string | undefined) => {
	useEffect(() => {
		if (title !== undefined) {
			document.title = `${title} | Nouveau`;
		}
	}, [title]);
};
