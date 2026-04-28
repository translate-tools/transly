/**
 * Integration test: real translateChunk wired into runTranslation.
 *
 * fetch is stubbed at the global level so no real network calls are made.
 * Everything else — cache, filesystem, chunking, flattening — runs for real.
 */
import { describe, expect, it, vi } from 'vitest';

import { translateChunk } from '../../src/llm.js';
import { runTranslation } from '../../src/runner.js';
import type { CacheFile } from '../../src/types.js';

import { makeConfig } from '../stubs/makeConfig.js';
import { makeFetchStub, makeOpenAiResponseObject } from '../stubs/makeFetchStub.js';
import { makeMemFs } from '../stubs/makeMemFs.js';

const fetchSpy = vi.spyOn(globalThis, 'fetch');
const mockApiResponse = (json: Record<string, string>) => {
	fetchSpy.mockImplementation(
		makeFetchStub(200, makeOpenAiResponseObject(JSON.stringify(json))),
	);
};

describe('LLM integration: translateChunk + runTranslation', () => {
	it('reads source file, calls the real LLM adapter, and writes translated output', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({
				title: 'Hello',
				nested: { message: 'World' },
			}),
		});

		// Stub fetch to return a valid OpenAI response for the two flat keys
		mockApiResponse({
			title: 'Hallo',
			'nested.message': 'Welt',
		});

		await runTranslation(makeConfig(), fs, translateChunk);

		expect(store.get('/locales/de/notes.json')).toBe(
			JSON.stringify(
				{
					title: 'Hallo',
					nested: { message: 'Welt' },
				},
				null,
				2,
			),
		);
	});

	it('writes cache with correct hashes after a successful LLM call', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ greeting: 'Hello' }),
		});

		mockApiResponse({ greeting: 'Hallo' });

		await runTranslation(makeConfig(), fs, translateChunk);

		expect(store.has('/cache/notes.de.json')).toBe(true);
		const cache = JSON.parse(store.get('/cache/notes.de.json')!) as CacheFile;
		expect(cache['greeting']).toBeDefined();
		expect(cache['greeting'].translation).toBe('Hallo');
	});

	it('does not call fetch on second run when nothing changed', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ greeting: 'Hello' }),
		});

		mockApiResponse({ greeting: 'Hallo' });

		// First run — populates cache
		await runTranslation(makeConfig(), fs, translateChunk);
		expect(fetchSpy).toHaveBeenCalled();
		fetchSpy.mockClear();

		// Second run — everything is cached
		await runTranslation(makeConfig(), fs, translateChunk);

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('propagates LLM HTTP errors through the pipeline', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ greeting: 'Hello' }),
		});

		fetchSpy.mockImplementation(
			makeFetchStub(429, { error: { message: 'Rate limit exceeded' } }),
		);

		await expect(runTranslation(makeConfig(), fs, translateChunk)).rejects.toThrow(
			'429',
		);
	});
});
