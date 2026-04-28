import { fillCacheFromTranslations } from 'src/cacheUtils.js';
import { describe, expect, it } from 'vitest';

import { runTranslation } from '../src/runner.js';
import { makeConfig } from './stubs/makeConfig.js';
import { makeMemFs } from './stubs/makeMemFs.js';
import { makeMockTranslate, type TranslateCallLog } from './stubs/makeTranslate.js';

describe.sequential('Rebuild the cache', () => {
	const config = makeConfig();
	const { fs, store } = makeMemFs({
		'/locales/en/notes.json': JSON.stringify({
			title: 'Hello',
			message: 'World',
			tags: ['Ideas', 'Health', 'Well Being'],
			'foo.bar': 'Name with dots',
			foo: {
				bar: 'Another value',
			},
		}),
	});

	it('translates all keys when cache is empty', async () => {
		const callLog: TranslateCallLog[] = [];
		await runTranslation(config, fs, makeMockTranslate(callLog));

		expect(JSON.parse(store.get('/locales/de/notes.json')!)).toStrictEqual({
			title: '[de] Hello',
			message: '[de] World',
			tags: ['[de] Ideas', '[de] Health', '[de] Well Being'],
			'foo.bar': '[de] Name with dots',
			foo: {
				bar: '[de] Another value',
			},
		});
		expect(store.has('/cache/notes.de.json')).toBe(true);
	});

	it('rebuild cache', async () => {
		// Remember cache
		const originalCache = store.get('/cache/notes.de.json');
		expect(originalCache).toBeTypeOf('string');

		// Delete cache
		store.delete('/cache/notes.de.json');
		expect(store.get('/cache/notes.de.json')).toBe(undefined);

		await fillCacheFromTranslations(config, fs);
		expect(store.get('/cache/notes.de.json')).toStrictEqual(originalCache);
	});

	it('skips unchanged keys on second run', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({
				title: 'Hello',
				message: 'World',
			}),
		});

		const mockTranslate = makeMockTranslate();

		await runTranslation(makeConfig(), fs, mockTranslate);
		expect(mockTranslate).toHaveBeenCalledTimes(1);

		mockTranslate.mockClear();
		await runTranslation(makeConfig(), fs, mockTranslate);
		expect(mockTranslate).toHaveBeenCalledTimes(0);
	});
});
