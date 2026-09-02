import { TableAggregate } from "@convex-dev/aggregate";

import { components } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";

/**
 * Follower counts over the watches table, namespaced by roaster. Kept in the
 * same transaction as every watch insert/delete by the mutations in watches.ts.
 */
export const followerCounts = new TableAggregate<{
	Key: Id<"watches">;
	DataModel: DataModel;
	Namespace: Id<"roasters">;
	TableName: "watches";
}>(components.aggregate, {
	namespace: (doc) => doc.roasterId,
	sortKey: (doc) => doc._id,
});
