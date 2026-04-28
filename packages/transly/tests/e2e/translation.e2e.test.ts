/* eslint-disable @cspell/spellchecker */
/**
 * Integration test: real translateChunk wired into runTranslation.
 *
 * fetch is stubbed at the global level so no real network calls are made.
 * Everything else — cache, filesystem, chunking, flattening — runs for real.
 */
import { defineConfig } from 'src';
import { describe, expect, it } from 'vitest';

import { translateChunk } from '../../src/llm.js';
import { runTranslation } from '../../src/runner.js';

import { makeMemFs } from '../stubs/makeMemFs.js';

const isE2EEnabled = process.env.TEST_E2E_LLM !== 'enabled' && process.env.OPENAI_API_KEY;

const containWords = (words: (string | RegExp)[], ignoreCase = false) =>
	expect.toSatisfy((value: string) => {
		expect(value).toBeTypeOf('string');
		words.forEach((word) => {
			if (typeof word === 'string' && ignoreCase) {
				expect(value.toLowerCase()).toMatch(word.toLowerCase());
			} else {
				expect(value).toMatch(word);
			}
		});

		return true;
	});

describe.skipIf(isE2EEnabled).concurrent('i18n locale files translation', () => {
	vi.setConfig({ testTimeout: 40_000, maxConcurrency: 10 });

	const cheapLLMTranslators = process.env.TEST_E2E_LLM_MODELS
		? process.env.TEST_E2E_LLM_MODELS.split(',')
		: [
				'openai/gpt-4o-mini',
				'mistralai/mistral-nemo',
				'amazon/nova-micro-v1',
				'google/gemma-3-12b-it',
				'qwen/qwen3-235b-a22b-2507',
				'xiaomi/mimo-v2-flash',
				'deepseek/deepseek-v3.2',
				'google/gemma-4-26b-a4b-it',
				'deepseek/deepseek-v4-flash',
			];

	cheapLLMTranslators.map((model) =>
		describe.sequential(model, () => {
			const { fs, store } = makeMemFs({
				'/locales/en/common.json': JSON.stringify({
					hello: 'Hello',
					nested: {
						world: 'World',
					},
				}),
				'/locales/en/interpolation.json': JSON.stringify({
					introduction: 'My name is {{name}}, I like {{hobby}}',
					strength:
						'My name is {{name}}, I can pull {{weight}}kg and hang {{hangTime}} minutes!',
				}),
			});

			const fetchSpy = vi.fn(fetch);
			beforeEach(() => {
				fetchSpy.mockClear();
			});

			const config = defineConfig({
				sourceLang: 'en',
				targetLangs: ['ru', 'it'],

				localesDir: '/locales',
				cacheDir: '/.transly',

				apiKey: process.env.OPENAI_API_KEY!,
				baseUrl: process.env.OPENAI_API_URL,

				model,
				contextPrompt: `We translate the user profiles bio with their stories. Make it sound native`,

				maxBatchSize: 50, // optional, default: 50
				fetch: fetchSpy,
				debug: true,
			});

			it('Translates source texts into all target languages', async () => {
				await runTranslation(config, fs, translateChunk);

				expect(store.has('/locales/ru/interpolation.json')).toBe(true);
				expect(JSON.parse(store.get('/locales/ru/interpolation.json')!)).toEqual({
					introduction: containWords(['{{name}}', /меня зовут/i]),
					strength: containWords(['{{hangTime}}', /минут|мин/i]),
				});

				expect(store.has('/locales/it/interpolation.json')).toBe(true);
				expect(JSON.parse(store.get('/locales/it/interpolation.json')!)).toEqual({
					introduction: expect.stringMatching(
						'Mi chiamo {{name}}|mio nome è {{name}}',
					),
					strength: expect.stringContaining('{{hangTime}} minuti'),
				});

				expect(fetchSpy).toBeCalled();
			});

			it('The API must not be called when cache is valid', async () => {
				await runTranslation(config, fs, translateChunk);

				expect(store.has('/locales/ru/interpolation.json')).toBe(true);
				expect(JSON.parse(store.get('/locales/ru/interpolation.json')!)).toEqual({
					introduction: containWords(['{{name}}', /меня зовут/i]),
					strength: containWords(['{{hangTime}}', /минут|мин/i]),
				});

				expect(store.has('/locales/it/interpolation.json')).toBe(true);
				expect(JSON.parse(store.get('/locales/it/interpolation.json')!)).toEqual({
					introduction: expect.stringMatching(
						'Mi chiamo {{name}}|mio nome è {{name}}',
					),
					strength: expect.stringContaining('{{hangTime}} minuti'),
				});

				expect(fetchSpy).not.toBeCalled();
			});

			it('The derived files must be restored from cache with no API calls', async () => {
				store.delete('/locales/ru/interpolation.json');
				expect(store.has('/locales/ru/interpolation.json')).toBe(false);

				await runTranslation(config, fs, translateChunk);

				expect(store.has('/locales/ru/interpolation.json')).toBe(true);
				expect(JSON.parse(store.get('/locales/ru/interpolation.json')!)).toEqual({
					introduction: expect.stringContaining('Меня зовут {{name}}'),
					strength: expect.stringContaining('{{hangTime}} минут'),
				});

				expect(fetchSpy).not.toBeCalled();
			});

			it('Only new keys must be translated', async () => {
				store.set(
					'/locales/en/interpolation.json',
					JSON.stringify({
						introduction: 'My name is {{name}}, I like {{hobby}}',
						strength:
							'My name is {{name}}, I can pull {{weight}}kg and hang {{hangTime}} minutes!',
						rating: 'My Yacht size is {{size}}cm',
					}),
				);

				const translateChunkSpy = vi.fn(translateChunk);
				await runTranslation(config, fs, translateChunkSpy);

				expect(store.has('/locales/ru/interpolation.json')).toBe(true);
				expect(JSON.parse(store.get('/locales/ru/interpolation.json')!)).toEqual({
					introduction: expect.stringContaining('Меня зовут {{name}}'),
					strength: expect.stringContaining('{{hangTime}} минут'),
					rating: expect.toSatisfy((value: string) => {
						expect(value).toMatch(/размер/i);
						expect(value).toMatch(/яхт/i);
						expect(value).toMatch(/{{size}}/i);

						return true;
					}),
				});

				expect(translateChunkSpy).toBeCalledWith(
					[
						{
							key: 'rating',
							value: 'My Yacht size is {{size}}cm',
						},
					],
					expect.any(String),
					config,
				);
				expect(translateChunkSpy).toBeCalledTimes(2);
			});
		}),
	);
});
