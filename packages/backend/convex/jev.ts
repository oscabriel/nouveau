// Shared Jev (TypeSafe System One) client. The shadow check and the page
// facts reader both ask /v1/systemone, so the request shape, the pin and
// the failure posture live here once.
//
// The model is pinned, not `jev-latest`: a threshold tuned on one version
// must not move under the alias. Every caller logs or stores the response's
// own `model` string, so the records stay exact even if the pinned constant
// drifts.
//
// askJev returns null on any failure and warns instead of throwing: a Jev
// opinion is never worth breaking the calling pipeline. askJev sends one
// request for a whole batch of independent questions; Jev evaluates them
// against the state in parallel, so extra questions cost almost nothing.

export const JEV_MODEL = "jev-1.13.0";
const JEV_TIMEOUT_MS = 10_000;
const JEV_URL = "https://api.typesafe.ai/v1/systemone";

/** One question: a yes/no Noul or a Choice over a criteria map. */
export interface JevQuestion {
	criteria?: Record<string, string | null>;
	instructions: string;
	type: "noul" | "choice";
}

/** The answers map, keyed by the question ids the caller chose. */
export type JevAnswers = Record<string, unknown>;

/**
 * One /v1/systemone request for a batch of questions. Null when the API is
 * unreachable, answers an unexpected shape, or the question batch is empty.
 */
export const askJev = async (
	apiKey: string,
	label: string,
	state: unknown,
	questions: Record<string, JevQuestion>
): Promise<{ answers: JevAnswers; model: string } | null> => {
	if (Object.keys(questions).length === 0) {
		return null;
	}
	let body: unknown;
	try {
		const response = await fetch(JEV_URL, {
			body: JSON.stringify({ model: JEV_MODEL, questions, state }),
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			method: "POST",
			signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
		});
		if (!response.ok) {
			console.warn(`jev ${label}: ${response.status}`);
			return null;
		}
		body = await response.json();
	} catch (error) {
		console.warn(
			`jev ${label} request failed: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		return null;
	}
	if (typeof body !== "object" || body === null) {
		return null;
	}
	const envelope = body as { answers?: unknown; model?: unknown };
	if (typeof envelope.answers !== "object" || envelope.answers === null) {
		return null;
	}
	return {
		answers: envelope.answers as JevAnswers,
		// The model that actually answered, which may differ from the pin.
		model: typeof envelope.model === "string" ? envelope.model : JEV_MODEL,
	};
};

/** One narrowed Choice answer: the pick, and the distribution when Jev sent a clean one. */
export interface JevChoice {
	choice: string;
	confidence?: number;
	/** Jev's probability per option, only when every key was sent and every value is a number. */
	probabilities?: Record<string, number>;
}

/**
 * The probabilities map, kept only when it is well formed: every key is an
 * option the caller sent and every value is a number. Anything else drops
 * the map rather than throwing; the choice itself still stands.
 */
const narrowProbabilities = (
	value: unknown,
	allowed: readonly string[]
): Record<string, number> | undefined => {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const probabilities: Record<string, number> = {};
	for (const [key, probability] of Object.entries(value)) {
		if (typeof probability !== "number" || !allowed.includes(key)) {
			return undefined;
		}
		probabilities[key] = probability;
	}
	return probabilities;
};

/**
 * Narrow one Choice answer. The choice must be in the set the caller sent;
 * anything else is a protocol error, never a fallback.
 */
export const jevChoice = (
	answer: unknown,
	allowed: readonly string[]
): JevChoice | null => {
	if (typeof answer !== "object" || answer === null) {
		return null;
	}
	const fields = answer as Record<string, unknown>;
	const { choice } = fields;
	if (typeof choice !== "string" || !allowed.includes(choice)) {
		return null;
	}
	const probabilities = narrowProbabilities(fields.probabilities, allowed);
	return {
		...(typeof fields.confidence === "number"
			? { confidence: fields.confidence }
			: {}),
		...(probabilities === undefined ? {} : { probabilities }),
		choice,
	};
};

/** The option Jev would have picked second: the highest probability other than the pick. */
export interface RunnerUp {
	option: string;
	probability: number;
}

/**
 * The runner-up in a Choice distribution: the highest-probability option
 * other than the chosen one. Null when the map is missing, has no other
 * option, or every other option is at zero. Pure.
 */
export const runnerUp = (
	probabilities: Record<string, number> | undefined,
	choice: string
): RunnerUp | null => {
	if (probabilities === undefined) {
		return null;
	}
	let best: RunnerUp | null = null;
	for (const [option, probability] of Object.entries(probabilities)) {
		if (
			option !== choice &&
			probability > 0 &&
			(best === null || probability > best.probability)
		) {
			best = { option, probability };
		}
	}
	return best;
};

/**
 * The probability Jev gave the pick itself: from the distribution when it
 * has one, else the answer's own confidence, else undefined.
 */
export const pickProbability = (chosen: JevChoice): number | undefined =>
	chosen.probabilities?.[chosen.choice] ?? chosen.confidence;

/** Narrow one Noul answer to its yes probability. */
export const jevNoul = (answer: unknown): number | null => {
	if (typeof answer !== "object" || answer === null) {
		return null;
	}
	const { noul } = answer as Record<string, unknown>;
	return typeof noul === "number" ? noul : null;
};
