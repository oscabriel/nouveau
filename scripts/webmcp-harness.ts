// Acts as a WebMCP agent against a running Nouveau, so the site tools can
// be listed and called without ChatGPT. Drives the system Chromium (153+
// exposes document.modelContext behind --enable-features=WebMCP) over the
// DevTools protocol and calls getTools / executeTool from the page.
//
//   bun run webmcp list [url]
//   bun run webmcp call <tool> [json-input] [url]
//
// Flags: --headed (watch it), --profile <dir> (reuse a profile: sign in once
// with --headed, then call save_lot against that profile), --chromium <path>.
// The url defaults to the Vite dev server. This proves our registration
// and handlers in a real browser, not ChatGPT compatibility; that check
// runs in the ChatGPT desktop app itself (.agents/research/webmcp-and-mcp.md).

const DEFAULT_URL = "http://127.0.0.1:3004/";
const TOOLS_WAIT_MS = 15_000;
const CALL_TIMEOUT_MS = 20_000;

interface Options {
	chromium: string;
	command: "call" | "list";
	headed: boolean;
	input: string;
	profile: string | null;
	tool: string;
	url: string;
}

const usage = (): never => {
	process.stderr.write(
		"usage: webmcp-harness list [url] | call <tool> [json] [url]  [--headed] [--profile <dir>] [--chromium <path>]\n"
	);
	process.exit(2);
};

const parseArgs = (argv: string[]): Options => {
	const positional: string[] = [];
	let chromium = "chromium";
	let headed = false;
	let profile: string | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--headed") {
			headed = true;
		} else if (arg === "--profile") {
			profile = argv[index + 1] ?? usage();
			index += 1;
		} else if (arg === "--chromium") {
			chromium = argv[index + 1] ?? usage();
			index += 1;
		} else if (arg !== undefined) {
			positional.push(arg);
		}
	}
	const [command, ...rest] = positional;
	if (command === "list") {
		return {
			chromium,
			command,
			headed,
			input: "{}",
			profile,
			tool: "",
			url: rest[0] ?? DEFAULT_URL,
		};
	}
	if (command === "call" && rest[0] !== undefined) {
		const [tool, second, third] = rest;
		const secondIsUrl = second?.startsWith("http") ?? false;
		return {
			chromium,
			command,
			headed,
			input: secondIsUrl ? "{}" : (second ?? "{}"),
			profile,
			tool,
			url: (secondIsUrl ? second : third) ?? DEFAULT_URL,
		};
	}
	return usage();
};

interface CdpMessage {
	error?: { message: string };
	id?: number;
	method?: string;
	result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
}

const connect = async (wsUrl: string) => {
	const ws = new WebSocket(wsUrl);
	await new Promise<void>((resolve, reject) => {
		ws.addEventListener("open", () => resolve(), { once: true });
		ws.addEventListener(
			"error",
			() => reject(new Error(`cannot connect to ${wsUrl}`)),
			{ once: true }
		);
	});
	let nextId = 0;
	const pending = new Map<number, (message: CdpMessage) => void>();
	const waiting = new Map<string, () => void>();
	ws.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data)) as CdpMessage;
		if (message.id !== undefined) {
			pending.get(message.id)?.(message);
			pending.delete(message.id);
		}
		if (message.method !== undefined) {
			waiting.get(message.method)?.();
			waiting.delete(message.method);
		}
	});
	const waitFor = (method: string) =>
		new Promise<void>((resolve) => {
			waiting.set(method, resolve);
		});
	const send = (method: string, params: Record<string, unknown> = {}) =>
		new Promise<CdpMessage>((resolve) => {
			nextId += 1;
			pending.set(nextId, resolve);
			ws.send(JSON.stringify({ id: nextId, method, params }));
		});
	const evaluate = async (expression: string): Promise<unknown> => {
		const message = await send("Runtime.evaluate", {
			awaitPromise: true,
			expression,
			returnByValue: true,
			timeout: CALL_TIMEOUT_MS,
		});
		if (message.error !== undefined) {
			throw new Error(`DevTools: ${message.error.message}`);
		}
		if (message.result?.exceptionDetails !== undefined) {
			throw new Error(
				`page threw: ${JSON.stringify(message.result.exceptionDetails)}`
			);
		}
		return message.result?.result?.value;
	};
	return { close: () => ws.close(), evaluate, send, waitFor };
};

const launch = async (options: Options) => {
	const profile =
		options.profile ??
		`${process.env.TMPDIR ?? "/tmp"}/nouveau-webmcp-${Date.now()}`;
	const args = [
		options.chromium,
		"--enable-features=WebMCP",
		"--remote-debugging-port=0",
		`--user-data-dir=${profile}`,
		"--no-first-run",
		"--no-default-browser-check",
		...(options.headed ? [] : ["--headless=new", "--disable-gpu"]),
		"about:blank",
	];
	const chrome = Bun.spawn(args, { stderr: "pipe", stdout: "ignore" });
	const decoder = new TextDecoder();
	let buffer = "";
	let wsBase = "";
	for await (const chunk of chrome.stderr) {
		buffer += decoder.decode(chunk);
		const match = /DevTools listening on (?<ws>ws:\/\/\S+)/u.exec(buffer);
		if (match?.groups?.ws !== undefined) {
			wsBase = match.groups.ws;
			break;
		}
	}
	if (wsBase === "") {
		throw new Error("chromium exited before DevTools was ready");
	}
	const { port } = new URL(wsBase);
	const response = await fetch(`http://127.0.0.1:${port}/json`);
	const targets = (await response.json()) as {
		type: string;
		webSocketDebuggerUrl: string;
	}[];
	const page = targets.find((target) => target.type === "page");
	if (page === undefined) {
		throw new Error("no page target");
	}
	return { chrome, page };
};

// Runs inside the page. Chromium 153 wants executeTool's input as a JSON
// string; the spec (and Chrome 155+) take an object. Try the object first.
const CALL_SCRIPT = (tool: string, input: string) => `(async () => {
	const mc = document.modelContext;
	if (!mc) return { harness: "no document.modelContext on this page" };
	const deadline = Date.now() + ${TOOLS_WAIT_MS};
	let tools = [];
	while (Date.now() < deadline) {
		tools = await mc.getTools();
		if (tools.length > 0) break;
		await new Promise((r) => setTimeout(r, 250));
	}
	const summary = tools.map((t) => ({ name: t.name, readOnly: t.annotations?.readOnlyHint ?? false }));
	const name = ${JSON.stringify(tool)};
	if (name === "") {
		return {
			tools: tools.map((t) => ({
				annotations: t.annotations,
				description: t.description,
				inputSchema: typeof t.inputSchema === "string" ? JSON.parse(t.inputSchema) : t.inputSchema,
				name: t.name,
			})),
		};
	}
	const target = tools.find((t) => t.name === name);
	if (!target) return { harness: "no such tool: " + name, tools: summary };
	const input = ${JSON.stringify(input)};
	let raw;
	try {
		raw = await mc.executeTool(target, JSON.parse(input));
	} catch (error) {
		if (!String(error).includes("Failed to parse input arguments")) throw error;
		raw = await mc.executeTool(target, input);
	}
	let result = raw;
	try { result = JSON.parse(raw); } catch {}
	return {
		pageAfter: location.pathname,
		result,
		resultChars: typeof raw === "string" ? raw.length : null,
		tool: name,
	};
})()`;

const main = async () => {
	const options = parseArgs(process.argv.slice(2));
	const { chrome, page } = await launch(options);
	const cdp = await connect(page.webSocketDebuggerUrl);
	try {
		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		const loaded = cdp.waitFor("Page.loadEventFired");
		await cdp.send("Page.navigate", { url: options.url });
		await loaded;
		const value = await cdp.evaluate(
			CALL_SCRIPT(options.command === "call" ? options.tool : "", options.input)
		);
		process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
	} finally {
		cdp.close();
		chrome.kill();
	}
};

await main();
