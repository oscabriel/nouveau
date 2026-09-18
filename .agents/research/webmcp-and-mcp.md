# WebMCP and MCP for Nouveau

Researched 2026-09-16 UTC against first-party documentation and local source at `b668a06`. This is a recommendation, not an implementation or a browser compatibility test. No deployment, account linking, or app data changes occurred.

## Recommendation

Add a small WebMCP integration first if the intended demo account can use OpenAI's site tools. Prove that access before building the integration. Keep a remote MCP server as the next step for assistants that should work without an open Nouveau page.

The product promise is: "Use Nouveau yourself, or let your own assistant use it with you."

WebMCP is a good fit for a visible demonstration of that promise. OpenAI now documents a working implementation and recently ran a dedicated WebMCP challenge. It is no longer accurate to describe OpenAI's participation as hypothetical. But support is still conditional, and the standard remains experimental. [S1, S2, S3]

Nouveau already has runtime OpenAI usage through Find my next bag. This addition would strengthen the story through a different interaction model, not repair a missing sponsor integration. The current hackathon criteria reward useful product behavior and actual sponsor work. They do not award a published WebMCP-specific bonus. [S10, R1]

## What WebMCP is

WebMCP lets a webpage publish named tools with descriptions, structured input schemas, and JavaScript handlers. A compatible browser agent discovers those tools when it visits the page. It can call an operation such as `save_lot` instead of inferring which button to click from the DOM or a screenshot. The handler can reuse the app's existing client and backend logic. [S1, S3, S4]

The current specification is a Draft Community Group Report from the W3C Web Machine Learning Community Group. It explicitly says it is not a W3C Standard and is not on the W3C Standards Track. Its editors include Microsoft and Google engineers. OpenAI implements the proposal; this is not an OpenAI-owned protocol. [S3]

WebMCP is MCP-inspired, not a remote MCP server embedded in a webpage. Publishing browser tools does not give a normal MCP client an HTTP endpoint it can connect to. Native WebMCP itself does not require hosting an MCP server. [S1, S5]

### How a Nouveau call would work

```text
User asks their assistant to save a coffee
  -> OpenAI's browser discovers Nouveau's site tools
  -> Browser reviews the requested tool call
  -> Nouveau's page executes save_lot
  -> Existing authenticated Convex client calls savedCoffees.save
  -> Convex checks the user and commits the save
  -> Subscribed Nouveau views show the new saved state
  -> Tool returns a receipt the assistant can verify
```

The browser session remains the user's session. Reusing it avoids a second account-linking flow, but does not remove backend authentication or authorization. Tool results reach the user's assistant and may reach its model provider. "Runs in the page" does not mean "all data stays on the device." [S1, R2]

Page tools disappear when the page closes or navigation removes their registration. A server job already started by a tool can continue independently, so closing the tab should not be described as undoing completed or queued work. [S1, S4]

### Two ways to define tools

- The imperative API registers tools in JavaScript. This is the appropriate path for Nouveau's React app and OpenAI compatibility.
- The declarative API annotates HTML forms. Chrome documents it, but OpenAI's current implementation does not expose those annotations as site tools. [S1, S4]

Current OpenAI docs, Chrome's imperative guide, and the draft specification use `document.modelContext.registerTool`. Older tutorials often show `navigator.modelContext`. Use the API supported by the tested browser rather than copying an old example. Feature-detect it and leave normal interactions unchanged in unsupported browsers. [S1, S3, S4]

Illustrative registration, assuming `readCurrentLot` is an existing validated application function:

```javascript
if (typeof document.modelContext?.registerTool === "function") {
	await document.modelContext.registerTool({
		name: "get_current_lot",
		description: "Read the coffee shown on the current Nouveau lot page.",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true },
		execute: async () => readCurrentLot(),
	});
}
```

This is explanatory code, not a tested addition to Nouveau. Registration cleanup, supported annotations, error handling, and schema validation need implementation and client tests. Chrome's current guide documents an AbortSignal-based registration lifetime. OpenAI supports only a subset of the broader API, so do not assume every draft method works there. [S1, S4]

## What can use it today

### OpenAI

OpenAI calls its implementation **Site tools**. The documented target is the built-in browser in the ChatGPT desktop app, used by ChatGPT Work and Codex. The current page says:

- Update the desktop app to the latest version.
- Use GPT-5.6 Sol or GPT-5.6 Terra for site tools.
- GPT-5.6 Luna currently has WebMCP disabled.
- Site tools are unavailable in Enterprise and Edu workspaces.
- Availability also depends on rollout.
- Register JavaScript tools in the top-level page. Declarative form tools and tools inside iframes are unsupported.
- Users can inspect Available site tools and recent tool activity, and disable site tools under browser permissions. [S1]

These are time-sensitive support statements, not permanent model recommendations. Recheck them on the recording day. Nouveau's server-side recommendation model is a separate choice; the desktop client limitation does not require changing that backend model.

Do not infer WebMCP support in every ChatGPT surface from generic browser support. OpenAI's broader browser documentation also discusses cloud browsing, but the site-tools page is the narrower authority for this integration. Codex CLI and the IDE extension do not include that built-in browser. Their regular MCP support is separate. [S1, S6, S9]

OpenAI's own documentation sites expose tools for searching docs, reading a page, inspecting the current context, navigating, and starting a custom guide. These provide a useful first compatibility test before modifying Nouveau. [S1]

### Chrome

Chrome documents an origin trial starting in Chrome 149, plus local development through `chrome://flags/#enable-webmcp-testing`. An origin trial is a limited browser experiment, not universal availability. The API also has origin-isolation and `tools` Permissions Policy requirements. [S4]

Google's Model Context Tool Inspector extension can list tools, invoke them, inspect schemas and outputs, and test natural-language selection. Its default chat model is Gemini. That can verify WebMCP behavior, but it would not establish OpenAI runtime usage for the sponsor story. [S4]

### What OpenAI has done beyond documentation

OpenAI ran the WebMCP Challenge from August 25 to September 4, with ten top prizes including $3,000 and a year of ChatGPT Pro each. Its page now says submissions are closed. This is a different event from Convex All Gas, whose deadline is September 22. [S2, S10]

The challenge page links OpenAI examples for collaborative writing, 3D modeling, crossword building, and shared travel planning. The interesting pattern is that the user and assistant operate on the same visible application state. That is the useful lesson for Nouveau, rather than copying the examples' complexity. [S2]

## Regular MCP instead

A remote MCP server would make Nouveau's selected data and actions accessible without loading the website. The assistant connects to an endpoint, discovers tools and their schemas, calls them, and reads structured results. A local stdio server is also possible, but a hosted HTTP endpoint is a better fit for an everyday consumer service. [S7, S8]

```text
ChatGPT / Codex / another compatible MCP host
  -> Remote Nouveau MCP endpoint
  -> Validate access token and requested permissions
  -> Authenticated Nouveau operations in Convex
  -> Return structured coffee data or a write receipt

An independently open Nouveau tab
  -> Convex subscriptions show the same persisted changes
```

A possible public endpoint is `https://<deployment>.convex.site/api/mcp`. That is a proposed route, not an existing service. Nouveau already mounts its app HTTP router under `/api`, with static hosting under `/`. Runtime and SDK transport compatibility would need a spike before choosing to host MCP inside Convex HTTP actions. An alternative is a small external MCP service calling authenticated Convex functions. Convex remains the app's backend either way. [R5]

Use an official MCP SDK rather than hand-writing JSON-RPC. OpenAI's server guide describes the TypeScript package `@modelcontextprotocol/sdk`, structured tool results, stable identifiers, and optional custom UI. No embedded ChatGPT UI is necessary for the first version. Pin a client-compatible SDK and protocol version; do not assume the latest protocol document describes every currently shipped client. [S8]

### OpenAI's regular MCP support

- ChatGPT developer mode supports remote MCP read and write tools, with Streamable HTTP and SSE. Its current eligibility list includes Plus, Pro, Business, Enterprise, and Education on the web. Workspace controls still matter. Developer-mode testing is not the same as public directory distribution. [S11]
- Codex supports local stdio and remote Streamable HTTP servers, including bearer-token and OAuth authentication. [S9]
- The Responses API can call remote MCP servers through an `mcp` tool configuration. It supports tool allowlists and approval controls. This requires an application using the API; adding an endpoint does not automatically make ordinary ChatGPT discover Nouveau. [S12]

### Authentication is the main extra job

Public coffee catalog tools could start without user authentication. Private saves, private recommendation runs, and writes require a verified user identity and authorization.

For ChatGPT account linking, OpenAI expects an OAuth 2.1 flow conforming to MCP authorization. This includes protected-resource metadata, authorization-server discovery, authorization code plus PKCE, client identification or registration, token validation, and scope enforcement. [S13]

Nouveau's Google login is an existing login flow for the website. It is not proof that Nouveau can issue scoped tokens to third-party MCP clients. That delegation flow needs investigation and implementation. Suggested permissions might separate catalog access, reading saves, writing saves, and managing watches.

A development bearer token can be useful in a client that supports it, such as Codex. Do not offer an admin token, ask users to paste browser session tokens into chat, or claim that a bearer-token demo establishes ChatGPT OAuth compatibility. Derive the caller from validated credentials, never an agent-supplied `userId`.

The Convex developer MCP configured for coding is not a customer integration. Do not expose deployment administration, raw database access, arbitrary function execution, or sponsor secrets as Nouveau tools.

### Tradeoffs

| Question | WebMCP | Remote MCP |
| --- | --- | --- |
| Where does the user start? | On Nouveau in a compatible browser | In an assistant with Nouveau connected |
| Must a Nouveau page be open? | Yes for its page tools | No |
| How does user identity work? | Reuses the page's signed-in session | Needs delegated credentials for private operations |
| How does the assistant find tools? | Discovers them on the visited page | Connects to the configured server |
| Can the person see the change? | Same live page | App reflects persisted changes when opened; custom assistant UI is optional |
| Main implementation risk | Experimental browser/client compatibility | Authentication, transport, hosting, and client setup |
| Best first use for Nouveau | Co-browsing and visible saving | Cross-app workflows and access outside the website |

Neither protocol supplies an autonomous scheduler by itself. A remote endpoint can support background workflows, but an assistant or separate job system must initiate them. Nouveau's own roaster monitoring already runs independently.

## A useful first tool set

Expose data and actions, not just a wrapper around Nouveau's recommender. The user's assistant should be able to perform the comparison itself. Calling our model from their model is optional, not the definition of supporting their assistant.

A first complete demo could use:

| Proposed tool | Contract |
| --- | --- |
| `find_available_lots` | Return a bounded set of eligible variants with lot IDs, bag sizes, USD prices, source timestamps, and roaster facts. Enforce hard constraints in backend code. |
| `get_lot` | Return the selected lot's facts and source links without unrelated user data. |
| `list_saved_lots` | Read only the signed-in user's private saves. |
| `save_lot` | Save a known lot idempotently. Return saved state and a link. No watch and no email. |
| `unsave_lot` | Undo the save without deleting the lot or a log. |

A smaller compatibility slice can start with `get_current_lot` and `save_lot` on an existing lot page. That is enough to prove discovery, authorization, and a visible database write before investing in catalog filtering.

The writes are already close to reusable. `savedCoffees.save` and `unsave` derive identity server-side and are idempotent. `listMine` is authenticated and paginated. Watch creation is also idempotent, but a watch has email consequences and is visible on public profiles, so it should be a separate, explicit action. [R2, R3, R6]

Catalog work is not just renaming the existing search query. `roasters.searchLots` searches names within one roaster and includes archived lots. `lots.get` returns merged facts and public logs, but does not return priced, eligible variants. A global budget-aware tool needs a bounded query or shared catalog helper with explicit freshness, currency, price, and size rules. Do not let the model manufacture those fields or imply that the initial candidate pool is the whole catalog. [R4]

Return stock as observed at a stated time, not a purchase guarantee. Keep source URLs and distinguish the roaster's descriptors from the assistant's explanation. Existing Firecrawl-enriched facts can be useful without another model call or scrape on every tool invocation.

Leave automatic public logging, arbitrary URL scraping, bulk writes, purchasing, and direct email sending out of the first version. If logs are exposed later, disclose that logs are public and require explicit publication intent. If expensive recommendation or refresh tools are added, describe their cost and preserve existing quotas.

## Security and verification

Tool descriptions, input schemas, and read-only annotations guide agents; they are not authorization controls. OpenAI documents a safety review per site-tool invocation, but also explicitly treats website tool definitions and results as untrusted. [S1]

For Nouveau:

- Validate arguments and ownership on the backend even if the browser validates the schema.
- Return only task-relevant data. Do not include emails, alert inbox contents, session tokens, or full account records.
- Treat roaster copy and user notes as untrusted data. They must not grant permission to save, publish, subscribe, or transmit data elsewhere.
- Use explicit save and unsave operations rather than toggles, because retries should not reverse the requested state.
- Respect unsupported browsers, auth loading, sign-out, route changes, and duplicate registrations.
- Test missing auth, another user's private data, invalid IDs, stale stock, duplicate writes, cancellation, and prompt injection embedded in source copy.
- Verify the visible result and actual tool trace in the intended OpenAI client. Ordinary browser clicking is not evidence of WebMCP execution.

## Demo and judging value

My assessment is that WebMCP has real value if it occupies roughly 30 to 45 seconds of the existing product demonstration and completes a useful task. Protocol setup and a list of tool names are weak demo material.

Suggested sequence:

1. Open the public Nouveau site in the supported OpenAI desktop browser and sign in normally.
2. Ask: "Find two floral coffees under $25, at least 200 g. Show me the roaster's words. Don't save anything yet."
3. Let the assistant use bounded catalog data and show sources. Unknown descriptors stay unknown.
4. Say: "Save the first one. Don't watch the roaster or turn on email."
5. Show the Saved state changing in Nouveau and briefly inspect the real site-tool call.
6. Optionally undo through the assistant and show the same state change.

The concise pitch is: "Nouveau remembers your coffee. Use our shortlist, or let your own assistant work with the same catalog and saved list."

Keep the existing grounded OpenAI recommendation flow and real Firecrawl and AgentMail evidence in the submission. Saving does not send an alert, and an earlier alert must not be presented as caused by a watch created seconds ago. The WebMCP Challenge's criteria and prizes do not apply to All Gas. [S2, S10]

Suggested decision gates, not effort guarantees:

1. Test OpenAI's own site tools on the demo account before building. If unavailable, do not base the main video on WebMCP.
2. Prove current-lot read plus save in Nouveau with a genuine site-tool call.
3. Add bounded discovery only after that succeeds.
4. Keep the integration if it improves the user story without delaying the working app, public URL, social post, or sub-three-minute video.
5. Build remote MCP later when a real workflow needs Nouveau outside an open tab. Both integrations can reuse the same backend rules without making the frontend call MCP.

## Sources

- **S1.** [OpenAI site tools](https://learn.chatgpt.com/docs/webmcp). Also reached through [the Codex WebMCP URL](https://developers.openai.com/codex/webmcp). Current availability, model limitations, top-level JavaScript registration, shared session, security review, docs-site examples.
- **S2.** [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/). Closed submission window, prizes, examples, and browser testing guidance.
- **S3.** [WebMCP specification](https://webmachinelearning.github.io/webmcp/). Draft dated September 15, 2026; status, editors, API, security considerations.
- **S4.** [Chrome WebMCP guide](https://developer.chrome.com/docs/ai/webmcp) and [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api). Trial, flag, inspector, APIs, permissions, registration lifecycle.
- **S5.** [Chrome comparison of WebMCP and MCP](https://developer.chrome.com/docs/ai/webmcp/compare-mcp). Distinct protocols, page-bound tools, complementary uses.
- **S6.** [OpenAI browser documentation](https://learn.chatgpt.com/docs/browser). Built-in browser versus CLI and IDE, separate cloud browser availability.
- **S7.** [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture). Host/client/server relationship, stdio, Streamable HTTP, JSON-RPC.
- **S8.** [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server). SDK, tool definitions, structured results, optional UI, deployment.
- **S9.** [OpenAI Codex MCP documentation](https://developers.openai.com/codex/mcp). Clients, transports, authentication, configuration, hosted versus local setup.
- **S10.** [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas). Current sponsor expectations, judging criteria, public URL, video, and September 22 deadline.
- **S11.** [ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode). Account eligibility, remote MCP setup, auth modes, read/write tools and confirmations.
- **S12.** [Responses API MCP guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp). Remote MCP, transports, authorization, approval and tool filtering.
- **S13.** [OpenAI MCP authentication guide](https://developers.openai.com/plugins/build/auth). OAuth requirements and token validation.
- **R1.** `hackathon.md`, including the real production recommendation and later production demo walk. Historical evidence, not a fresh production test.
- **R2.** `packages/backend/convex/savedCoffees.ts`.
- **R3.** `packages/backend/convex/watches.ts`.
- **R4.** `packages/backend/convex/roasters.ts` and `packages/backend/convex/lots.ts`.
- **R5.** `packages/backend/convex/http.ts` and `packages/backend/convex/convex.config.ts`.
- **R6.** `PRODUCT.md` and `CONTEXT.md`, supplemented by the newer source and build log where these summaries lag implementation.

Raw search responses and fetched pages were saved under `/tmp/nouveau-webmcp-research/`. Those temporary files are not a durable repository artifact; the source links above are the references for this note.
