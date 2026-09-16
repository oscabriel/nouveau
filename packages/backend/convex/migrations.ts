// Online data migrations (@convex-dev/migrations). Run one from the CLI:
//   npx convex run migrations:run '{"fn": "migrations:roasterNotesToList"}'
// (`--prod` for production). The component tracks progress, so a rerun
// resumes instead of starting over.

import { Migrations } from "@convex-dev/migrations";

import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { splitNotes } from "./lotFacts";

export const migrations = new Migrations<DataModel>(components.migrations);

/**
 * ADR-0005: `products.roasterNotes` was one clause string; it is a list now.
 * Rows written before the change carry the string; this splits it through
 * the same shape check the extractor applies, so a swallowed clause (D3)
 * drops out instead of becoming a "note". An empty result clears the field:
 * the next crawl re-extracts from the roaster's copy anyway.
 */
export const roasterNotesToList = migrations.define({
	migrateOne: (_ctx, product) => {
		if (typeof product.roasterNotes !== "string") {
			return;
		}
		const notes = splitNotes(product.roasterNotes);
		return { roasterNotes: notes.length === 0 ? undefined : notes };
	},
	table: "products",
});

export const run = migrations.runner();
