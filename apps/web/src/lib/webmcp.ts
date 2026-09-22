// The browser side of WebMCP (https://webmachinelearning.github.io/webmcp/):
// a page registers named tools on `document.modelContext`, and an agent in
// the browser (ChatGPT's desktop app, Chrome behind a flag) discovers and
// calls them. Only the subset every current implementation agrees on is
// typed here: `registerTool` with an AbortSignal for the registration's
// lifetime. Nothing else on the draft interface is relied on.

/** The JSON Schema subset a tool's `inputSchema` uses. */
export interface ToolInputSchema {
	type: "object";
	properties: Record<
		string,
		{
			type: "string" | "number" | "boolean";
			description?: string;
			enum?: readonly string[];
		}
	>;
	required?: string[];
	additionalProperties: false;
}

export interface ToolAnnotations {
	/** The tool changes nothing the user can see. */
	readOnlyHint?: boolean;
	/** The agent should confirm with the user before calling. */
	consequentialHint?: boolean;
	/** The result carries copy from outside the app (a roaster's words). */
	untrustedContentHint?: boolean;
}

export interface SiteTool {
	name: string;
	description: string;
	inputSchema: ToolInputSchema;
	annotations: ToolAnnotations;
	execute: (
		input: unknown,
		options?: { signal?: AbortSignal }
	) => Promise<unknown>;
}

export interface ModelContext {
	registerTool: (
		tool: SiteTool,
		options?: { signal?: AbortSignal }
	) => Promise<void>;
}

/**
 * The page's model context when this browser has one, else null. Every
 * other browser gets the ordinary site and never sees a warning.
 */
export const modelContextOf = (doc: Document): ModelContext | null => {
	const candidate = (doc as { modelContext?: unknown }).modelContext;
	if (typeof candidate !== "object" || candidate === null) {
		return null;
	}
	if (!("registerTool" in candidate)) {
		return null;
	}
	if (typeof candidate.registerTool !== "function") {
		return null;
	}
	return candidate as ModelContext;
};

/**
 * Register every tool for as long as `signal` stays live; aborting it
 * unregisters them all. Returns the names that registered.
 */
export const registerSiteTools = async (
	modelContext: ModelContext,
	tools: SiteTool[],
	signal: AbortSignal
): Promise<string[]> => {
	const outcomes = await Promise.allSettled(
		tools.map((tool) => modelContext.registerTool(tool, { signal }))
	);
	// A rejected one (a name the browser refuses, a remount race) is left
	// out; the rest are live.
	return tools
		.filter((_, index) => outcomes[index]?.status === "fulfilled")
		.map((tool) => tool.name);
};
