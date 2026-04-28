/* eslint-disable @cspell/spellchecker */

/**
 * Builds a minimal OpenAI-compatible chat completion response body.
 * Pass `content` as the assistant message text (typically a JSON string).
 */
export function makeOpenAiResponseObject(content: string): unknown {
	return {
		id: 'chatcmpl-test',
		object: 'chat.completion',
		choices: [
			{
				index: 0,
				message: { role: 'assistant', content },
				// eslint-disable-next-line camelcase
				finish_reason: 'stop',
			},
		],
	};
}

/**
 * Returns a `fetch` stub that resolves with the given HTTP status and JSON body.
 */
export function makeFetchStub(status: number, body: unknown): typeof fetch {
	return async (_url: RequestInfo | URL, _init?: RequestInit) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
}

/**
 * Returns a `fetch` stub that resolves with the given HTTP status and raw text body.
 */
export function makeFetchStubText(status: number, text: string): typeof fetch {
	return async (_url: RequestInfo | URL, _init?: RequestInit) =>
		new Response(text, {
			status,
			headers: { 'Content-Type': 'text/plain' },
		});
}

/**
 * Returns a `fetch` stub that rejects, simulating a network-level failure
 * (e.g. DNS failure, connection refused, timeout).
 */
export function makeNetworkErrorStub(message = 'Failed to fetch'): typeof fetch {
	return async (_url: RequestInfo | URL, _init?: RequestInit) => {
		throw new TypeError(message);
	};
}
