/* eslint-disable @cspell/spellchecker */
import { APIConnectionError } from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { translateChunk } from '../src/llm.js';
import type { TranslationItem } from '../src/types.js';
import { makeConfig } from './stubs/makeConfig.js';
import {
	makeFetchStub,
	makeFetchStubText,
	makeNetworkErrorStub,
	makeOpenAiResponseObject,
} from './stubs/makeFetchStub.js';

const items: TranslationItem[] = [
	{ key: 'greeting', value: 'Hello' },
	{ key: 'farewell', value: 'Goodbye' },
];

const fetchSpy = vi.spyOn(globalThis, 'fetch');
const mockApiResponse = (json: Record<string, string>) => {
	fetchSpy.mockImplementation(
		makeFetchStub(200, makeOpenAiResponseObject(JSON.stringify(json))),
	);
};

describe('happy path', () => {
	it('returns a key-value map for a successful response', async () => {
		mockApiResponse({ greeting: 'Hallo', farewell: 'Auf Wiedersehen' });

		await expect(translateChunk(items, 'de', makeConfig())).resolves.toEqual({
			greeting: 'Hallo',
			farewell: 'Auf Wiedersehen',
		});
	});

	it('strips markdown code fences wrapping the JSON', async () => {
		const fenced = '```json\n{"greeting":"Hallo","farewell":"Auf Wiedersehen"}\n```';
		fetchSpy.mockImplementation(makeFetchStub(200, makeOpenAiResponseObject(fenced)));

		await expect(translateChunk(items, 'de', makeConfig())).resolves.toEqual({
			greeting: 'Hallo',
			farewell: 'Auf Wiedersehen',
		});
	});

	it('strips plain code fences (no language tag)', async () => {
		const fenced = '```\n{"greeting":"Hallo","farewell":"Auf Wiedersehen"}\n```';
		fetchSpy.mockImplementation(makeFetchStub(200, makeOpenAiResponseObject(fenced)));

		await expect(translateChunk(items, 'de', makeConfig())).resolves.toEqual({
			greeting: 'Hallo',
			farewell: 'Auf Wiedersehen',
		});
	});
});

describe('outgoing request', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('sends a POST to the correct endpoint with auth header', async () => {
		mockApiResponse({ greeting: 'Hallo', farewell: 'Tschüss' });
		await translateChunk(items, 'de', makeConfig({ apiKey: 'sk-test-123' }));

		expect(fetchSpy).toHaveBeenLastCalledWith(
			expect.stringContaining('/chat/completions'),
			expect.objectContaining({
				method: 'POST',
				headers: expect.toSatisfy((headers: Headers) => {
					expect(headers.get('authorization')).toBe('Bearer sk-test-123');
					expect(headers.get('Content-Type')).toBe('application/json');
					return true;
				}),
			}),
		);
	});

	it('sends model, system prompt, and user content in the request body', async () => {
		mockApiResponse({ greeting: 'Hallo', farewell: 'Tschüss' });

		const config = makeConfig({
			model: 'openai/gpt-4o-mini',
			systemPrompt: 'Translate carefully.',
			contextPrompt: 'Our app is a note taking app',
		});
		await translateChunk(items, 'de', config);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
			model: 'openai/gpt-4o-mini',
			messages: [
				{ role: 'system', content: 'Translate carefully.' },
				{
					role: 'system',
					content: expect.stringContaining('Our app is a note taking app'),
				},
				{
					role: 'user',
					content: expect.toSatisfy((value: string) => {
						expect(value).toBeTypeOf('string');
						expect(JSON.parse(value)).toEqual({
							farewell: 'Goodbye',
							greeting: 'Hello',
						});

						return true;
					}),
				},
			],
		});
	});

	it('uses the default OpenAI base URL when baseUrl is not set', async () => {
		mockApiResponse({ greeting: 'Hallo', farewell: 'Tschüss' });
		await translateChunk(items, 'de', makeConfig({ baseUrl: undefined }));

		expect(fetchSpy).toBeCalledWith(
			'https://api.openai.com/v1/chat/completions',
			expect.any(Object),
		);
	});

	it('uses a custom baseUrl when provided', async () => {
		mockApiResponse({ greeting: 'Hallo', farewell: 'Tschüss' });
		await translateChunk(items, 'de', makeConfig({ baseUrl: 'https://my.proxy/v1' }));

		expect(fetchSpy).toBeCalledWith(
			'https://my.proxy/v1/chat/completions',
			expect.any(Object),
		);
	});

	it('strips trailing slash from baseUrl', async () => {
		mockApiResponse({ greeting: 'Hallo', farewell: 'Tschüss' });
		await translateChunk(
			items,
			'de',
			makeConfig({ baseUrl: 'https://my.proxy/v1/' }),
		);

		expect(fetchSpy).toBeCalledWith(
			'https://my.proxy/v1/chat/completions',
			expect.any(Object),
		);
	});
});

describe.skip('network errors', () => {
	it('throws a descriptive error when fetch rejects (network failure)', async () => {
		fetchSpy.mockImplementation(makeNetworkErrorStub('Emulated network error'));

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow(
			APIConnectionError,
		);
	});

	it('throws on 401 Unauthorized (invalid API key)', async () => {
		fetchSpy.mockImplementation(makeFetchStub(401, { error: 'Invalid API key' }));

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow('401');
	});

	it('throws on 429 Too Many Requests (rate limit)', async () => {
		fetchSpy.mockImplementation(
			makeFetchStub(429, { error: { message: 'Rate limit exceeded' } }),
		);

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow('429');
	});

	it('throws on 500 Internal Server Error', async () => {
		fetchSpy.mockImplementation(
			makeFetchStub(500, { error: 'Internal server error' }),
		);

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow('500');
	});

	it('throws on 503 Service Unavailable', async () => {
		fetchSpy.mockImplementation(makeFetchStubText(503, 'Service Unavailable'));

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow('503');
	});
});

describe('malformed responses', () => {
	it('throws when the response body is not valid JSON', async () => {
		fetchSpy.mockImplementation(makeFetchStubText(200, 'this is not json'));

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow(
			expect.objectContaining({
				message: 'Connection error.',
				cause: expect.objectContaining({
					message:
						'API error: expected JSON but got text/plain. Check baseURL. Preview: this is not json',
				}),
			}),
		);
	});

	it('throws when `choices` field is missing', async () => {
		fetchSpy.mockImplementation(
			makeFetchStub(200, { id: 'test', object: 'chat.completion' }),
		);

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow(
			'Unexpected LLM response shape',
		);
	});

	it('throws when `choices` array is empty', async () => {
		fetchSpy.mockImplementation(makeFetchStub(200, { choices: [] }));

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow(
			'Unexpected LLM response shape',
		);
	});

	it('throws when `message.content` is null', async () => {
		fetchSpy.mockImplementation(
			makeFetchStub(200, {
				choices: [{ message: { role: 'assistant', content: null } }],
			}),
		);

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow(
			'LLM response is empty',
		);
	});

	it('throws when content is a plain string (not JSON)', async () => {
		fetchSpy.mockImplementation(
			makeFetchStub(
				200,
				makeOpenAiResponseObject('Sure, here are the translations!'),
			),
		);

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow(
			'non-JSON content',
		);
	});

	it('throws when content is a JSON array instead of an object', async () => {
		fetchSpy.mockImplementation(
			makeFetchStub(200, makeOpenAiResponseObject('[1, 2, 3]')),
		);

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow(
			'Expected object, received array',
		);
	});

	it('throws when a requested key is missing from the translation map', async () => {
		// Only returns 'greeting', missing 'farewell'
		mockApiResponse({ greeting: 'Hallo' });

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow(
			'"farewell"',
		);
	});

	it('throws when a key value is not a string', async () => {
		fetchSpy.mockImplementation(
			makeFetchStub(
				200,
				makeOpenAiResponseObject(
					JSON.stringify({ greeting: 'Hallo', farewell: 42 }),
				),
			),
		);

		await expect(translateChunk(items, 'de', makeConfig())).rejects.toThrow(
			'"farewell"',
		);
	});
});
