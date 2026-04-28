/* eslint-disable @cspell/spellchecker */
import { MicrosoftTranslator } from 'anylang/translators';
import { defineConfig } from 'src';
import { anylangAdapter } from 'src/anylang';
import { describe, expect, it } from 'vitest';

import { runTranslation } from '../../src/runner';

import { makeMemFs } from '../stubs/makeMemFs';

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

vi.setConfig({ testTimeout: 40_000, maxConcurrency: 10 });

describe.sequential('MicrosoftTranslator', () => {
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

	const translator = anylangAdapter(new MicrosoftTranslator());
	const config = defineConfig({
		sourceLang: 'en',
		targetLangs: ['ru', 'it'],

		localesDir: '/locales',
		cacheDir: '/.transly',
		maxBatchSize: 50, // optional, default: 50
		debug: true,
	});

	it('Translates source texts into all target languages', async () => {
		await runTranslation(config, fs, translator);

		expect(store.has('/locales/ru/interpolation.json')).toBe(true);
		expect(JSON.parse(store.get('/locales/ru/interpolation.json')!)).toEqual({
			introduction: containWords(['{{name}}', /меня зовут/i]),
			strength: containWords(['{{hangTime}}', /минут|мин/i]),
		});

		expect(store.has('/locales/it/interpolation.json')).toBe(true);
		expect(JSON.parse(store.get('/locales/it/interpolation.json')!)).toEqual({
			introduction: expect.stringMatching('Mi chiamo {{name}}|mio nome è {{name}}'),
			strength: expect.stringContaining('{{hangTime}} minuti'),
		});
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

		const translateChunkSpy = vi.fn(translator);
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
});
