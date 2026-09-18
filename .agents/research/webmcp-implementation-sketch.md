# WebMCP implementation sketch

Proposed integration for Nouveau in the ChatGPT desktop app's built-in browser. This captures the implementation discussion, not shipped behavior or verified client compatibility. For protocol research, OpenAI support limitations, and source links, see [WebMCP and MCP for Nouveau](webmcp-and-mcp.md).

## Product direction

Nouveau works with the assistant beside your browser. The user brings their own assistant, which reads Nouveau's coffee data and makes changes the person can see in the app.

No new chatbot, remote MCP server, or separate account-linking flow. The assistant can use ordinary computer interaction where it helps, and WebMCP tools where precise data or reliable writes matter.

Computer use in an arbitrary browser does not guarantee WebMCP access. The first supported target is OpenAI's documented built-in browser. Other environments keep the normal website and can use ordinary browser interaction.

## Demo experience

The user opens Nouveau in the ChatGPT app's built-in browser and signs in normally.

> Find a floral coffee under $25, at least 200 grams. Give me a couple of options and show me what the roasters actually say.

The assistant:

1. Reads Nouveau's available coffee data through a tool.
2. Compares the returned options itself.
3. Opens a lot page so the person can inspect the source material.

Then the user asks:

> Save this one. Don't turn on email alerts.

The assistant saves it. The page's Save button changes to Saved, and the coffee appears in Want to try.

The demonstration should show the assistant making a real change in the same app the person is looking at. Include the actual site-tool trace so ordinary browser clicking is not mistaken for WebMCP execution.

## Architecture

```text
ChatGPT conversation             Nouveau in its browser
         │                                │
         └──── discovers site tools ──────┤
                                          │
                              WebMCP registration module
                                          │
                              Existing authenticated
                                   Convex client
                                          │
                         ┌────────────────┴────────────────┐
                         │                                 │
                  Coffee data reads                 Existing writes
                 eligibility + evidence             save / unsave
                         │                                 │
                         └────────────────┬────────────────┘
                                          │
                                  Convex database
                                          │
                              Reactive UI updates
```

WebMCP is a small frontend adapter. Convex keeps ownership of permissions, catalog rules, and persistence. The user's assistant handles the reasoning; Nouveau supplies bounded, sourced data and explicit actions.

Do not:

- Put an OpenAI key in the browser.
- Forward the user's conversation to our backend. Tool arguments should contain only what the requested operation needs.
- Create another agent or recommendation pipeline.
- Make the frontend call an MCP server.
- Expose Convex's developer or administrative tools.

The existing Find my next bag experience remains available. The WebMCP path does not need to invoke it or make a second OpenAI call on the user's behalf.

## Initial tool set

| Tool | Contract |
| --- | --- |
| `get_context` | Current Nouveau route, current lot ID if applicable, and whether sign-in is ready. No account dump. |
| `find_available_lots` | Find a bounded selection using preference words, a USD budget, and minimum bag size. |
| `get_lot` | Read one lot's facts, source links, and any currently eligible offer. Archived lots still resolve, without an available offer. |
| `list_saved_lots` | Read the signed-in user's private saved list, paginated. |
| `save_lot` | Save a known lot. Repeating the call does not create a duplicate. |
| `unsave_lot` | Remove a save. Repeating the call is harmless. |
| `open_page` | Navigate to an allowed Nouveau destination, such as a lot or Saved. No arbitrary URLs or JavaScript. |

Navigation matters because reading a tool result does not automatically change what the person sees. The assistant should be able to say "Let's look at this one" and open its page.

Keep watches and public log creation out of the first slice. They introduce email and publication consequences. Saving is private and reversible.

### Discovery inputs and results

Illustrative contract, not a final implementation signature:

```ts
type FindAvailableLotsInput = {
	preferences: string;
	maxPriceCents?: number;
	minGrams?: number;
};

type LotOption = {
	lotId: string;
	name: string;
	roasterName: string;
	lotPageUrl: string;
	shopUrl: string;
	offer: {
		variantId: string;
		variantName: string;
		priceCents: number;
		currency: "USD";
		grams: number;
		observedAt: number;
	};
	evidence: {
		text: string;
		sourceUrl: string;
		observedAt: number;
	}[];
};
```

The distinction between constraints and preferences stays explicit:

- Price and bag size are hard constraints, enforced by backend code.
- "Floral" is a preference, supported or unsupported by the returned evidence.
- Availability means observed availability at the stated timestamp, not a purchase guarantee.
- Results are a bounded selection, not a claim that every coffee was searched exhaustively.

The result envelope should describe bounded coverage. An empty selection must not imply that no matching coffee exists anywhere in the catalog.

No generated explanations are necessary in this response. ChatGPT writes those. Tool descriptions must distinguish the roaster's descriptors from the assistant's interpretation.

For `get_lot`, an unavailable or archived lot returns its facts with a null offer and an explicit reason, rather than disappearing or acquiring an invented price.

## Reuse existing backend behavior

`packages/backend/convex/recommendationCatalog.ts` already provides:

- Fresh-source and US/USD eligibility checks.
- Exact-variant stock and size checks.
- Cheapest qualifying variant selection.
- Bounded, round-robin candidate selection across roasters.
- Preference scoring and source passages.

Reuse that machinery without invoking the recommendation worker or OpenAI.

Add a narrow public catalog entry point that obtains server time and calls a validated internal query using those helpers. The expensive reads remain bounded. Expose the selection limits honestly rather than presenting the result as exhaustive search. Read the Convex guidelines before implementing these entry points.

For writes, `savedCoffees.save` and `unsave` already derive the caller from the authenticated session and are idempotent. `savedCoffees.listMine` already provides authenticated, paginated Saved reads.

The existing `lots.get` response includes public logs but lacks priced variants. The tool should return a deliberately chosen coffee payload rather than dump that response unchanged. Reuse shared logic where necessary without exposing unrelated user data.

## Proposed files

```text
apps/web/src/
  components/
    site-tools.tsx              Mount inside existing providers
  lib/
    site-tools.ts               Definitions, validation, handlers
    webmcp.ts                   Browser support and registration lifetime

packages/backend/convex/
  catalog.ts                    New bounded catalog entry points
  recommendationCatalog.ts     Reuse existing selection rules
  savedCoffees.ts               Reuse existing save operations
```

`site-tools.tsx` mounts once from `routes/__root.tsx`, rather than each route independently registering overlapping tools.

It should:

- Feature-detect `document.modelContext`.
- Register only the supported tools.
- Read current route and authentication state at invocation time.
- Clean up registrations on unmount.
- Handle sign-out and account changes without retaining stale private results.
- Return structured errors such as `sign_in_required`, `unknown_lot`, and `temporarily_unavailable`.

Registration and cleanup must follow the APIs verified in the target OpenAI browser. Do not assume it implements every method in the latest draft. Keep browser-specific lifecycle handling in `webmcp.ts`, not spread across route components.

## Keep the website human-first

Do not add an agent dashboard or a second results interface for this integration.

Use the existing lot pages, Saved list, and feedback:

- The assistant opens an ordinary lot page.
- Saving updates the ordinary Save button.
- A brief confirmation can offer Undo through the existing unsave operation.
- The user can immediately continue with mouse or keyboard.

A tool receipt should state what that operation changed. For example:

```json
{
	"status": "saved",
	"lotId": "...",
	"visibility": "private",
	"watchCreated": false,
	"emailEnabled": false
}
```

Here `emailEnabled: false` means the save did not enable email. It must not claim that the user has no pre-existing email alerts. Final receipt field names should make that distinction clear.

An unsupported browser gets the same site without tool registration, not a warning or blocked experience.

Opening a lot page may trigger the existing on-view Firecrawl enrichment. Retain its current deduplication and quotas. A read-only catalog call must not secretly launch new scrapes. Describe navigation side effects honestly rather than labeling every non-save tool read-only.

## Permissions and failure behavior

The browser's tool-call safety checks help, but do not replace backend checks.

Requirements:

- No `userId` argument for private reads or writes.
- No emails, inbox contents, credentials, or unrelated user records in results.
- Source copy is data, never instructions granting permission.
- Use explicit save and unsave operations, never a toggle.
- Never automatically retry a write under a different signed-in account.
- Never claim cancellation undoes a mutation already committed.

The browser session handles sign-in. Do not ask the assistant to extract or transmit its session token. Tool results reach the user's assistant, so sharing private Saved data should follow the user's task rather than occur automatically on page load.

## Implementation slices

### Slice 1: prove the actual OpenAI path

Implement `get_context`, `get_lot`, and `save_lot`.

Test in the intended ChatGPT account:

- Tools appear in Available site tools.
- The assistant makes a real tool call.
- A save persists and changes the visible page.
- Signed-out writes fail safely.

This is the go/no-go gate. Verify client and model support before committing the main demo to WebMCP. The research note records support at research time; recheck OpenAI's documentation and the actual client before recording.

### Slice 2: complete the coffee task

Add bounded discovery, Saved reads, unsave, and navigation.

Test the full request through comparison, inspection, save, and undo. Verify that the assistant can distinguish a soft preference from a hard budget or size constraint, and that it returns source-backed choices rather than invented coffee facts.

### Slice 3: make it dependable

Cover:

- Duplicate registration and React remounts.
- Route changes and sign-out during calls.
- Malformed IDs and cross-user privacy.
- Stale offers and empty results.
- Duplicate writes and cancellation.
- Prompt injection embedded in roaster copy.
- Unsupported-browser behavior.

Use backend tests for eligibility and ownership, frontend tests for tool contracts and lifecycle behavior, and the actual OpenAI client for discovery and execution compatibility. A mocked `modelContext` is not proof of client support.

Record the real interaction on the public site, including a brief view of the tool trace. Keep the existing grounded OpenAI recommendation and genuine Firecrawl and AgentMail evidence in the broader hackathon demo.

## Scope boundary

The proposed release supports discovering, inspecting, saving, and undoing with the user's own assistant.

Deferred:

- Remote MCP hosting and OAuth account linking.
- Autonomous purchasing or arbitrary external navigation.
- Public log creation or editing through tools.
- Watch creation, alert settings, and direct email sending through tools.
- Arbitrary URL scraping or new background automation.
- A new chat interface or persistent agent conversation system.

This adds another way to use Nouveau without turning it into a chat app or committing the project to a remote MCP service.
