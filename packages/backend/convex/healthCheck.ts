import { v } from "convex/values";

import { query } from "./_generated/server";

export const get = query({
	args: {},
	handler: () => "OK",
	returns: v.string(),
});
