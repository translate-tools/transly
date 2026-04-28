import { describe, expect, it, vi } from 'vitest';

import { computeHash } from '../src/cache.js';
import { runTranslation } from '../src/runner.js';
import type { CacheFile, TranslationItem } from '../src/types.js';
import { makeConfig } from './stubs/makeConfig.js';
import { makeMemFs } from './stubs/makeMemFs.js';
import { makeMockTranslate, type TranslateCallLog } from './stubs/makeTranslate.js';

// Use a small batch size so tests can force multiple chunks with few keys.
const config = makeConfig({ maxBatchSize: 2 });

describe('Partial failure handling', () => {
	it('preserves successful chunk in cache when second chunk fails', async () => {
		// 4 keys, batch size 2 → 2 chunks; chunk 2 throws
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({
				key0: 'value 0',
				key1: 'value 1',
				key2: 'value 2',
				key3: 'value 3',
			}),
		});

		let callCount = 0;
		const mockTranslate = vi.fn(
			async (items: TranslationItem[], targetLang: string) => {
				callCount++;
				if (callCount === 2) throw new Error('LLM rate limit exceeded');

				const result: Record<string, string> = {};
				for (const item of items) {
					result[item.key] = `[${targetLang}] ${item.value}`;
				}
				return result;
			},
		);

		await expect(runTranslation(config, fs, mockTranslate)).rejects.toThrow(
			'LLM rate limit exceeded',
		);

		expect(store.has('/cache/notes.de.json')).toBe(true);
		const cache = JSON.parse(store.get('/cache/notes.de.json')!) as CacheFile;

		expect(cache['key0']).toBeDefined();
		expect(cache['key0'].hash).toBe(computeHash('value 0'));
		expect(cache['key0'].translation).toBe('[de] value 0');

		expect(cache['key1']).toBeDefined();
		expect(cache['key1'].hash).toBe(computeHash('value 1'));
		expect(cache['key1'].translation).toBe('[de] value 1');

		expect(cache['key2']).toBeUndefined();
		expect(cache['key3']).toBeUndefined();
	});

	it('resumes from where it left off on retry after partial failure', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({
				key0: 'value 0',
				key1: 'value 1',
				key2: 'value 2',
				key3: 'value 3',
			}),
		});

		let callCount = 0;
		const failingTranslate = vi.fn(
			async (items: TranslationItem[], targetLang: string) => {
				callCount++;
				if (callCount === 2) throw new Error('Simulated failure');

				const result: Record<string, string> = {};
				for (const item of items) {
					result[item.key] = `[${targetLang}] ${item.value}`;
				}
				return result;
			},
		);

		await expect(runTranslation(config, fs, failingTranslate)).rejects.toThrow();

		// Second run — key0 and key1 are cached; only key2 and key3 need translation
		const callLog: TranslateCallLog[] = [];
		const retryTranslate = makeMockTranslate(callLog);

		await runTranslation(config, fs, retryTranslate);

		expect(retryTranslate).toHaveBeenCalledTimes(1);
		expect(callLog[0].items.map((i) => i.key)).toEqual(
			expect.arrayContaining(['key2', 'key3']),
		);
		expect(callLog[0].items).toHaveLength(2);

		const output = JSON.parse(store.get('/locales/de/notes.json')!);
		expect(output.key0).toBe('[de] value 0');
		expect(output.key1).toBe('[de] value 1');
		expect(output.key2).toBe('[de] value 2');
		expect(output.key3).toBe('[de] value 3');
	});

	it('does not corrupt cache when first chunk fails', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({
				key0: 'value 0',
				key1: 'value 1',
			}),
		});

		const mockTranslate = vi.fn(async () => {
			throw new Error('Immediate failure');
		});

		await expect(runTranslation(config, fs, mockTranslate)).rejects.toThrow(
			'Immediate failure',
		);

		expect(store.has('/cache/notes.de.json')).toBe(false);
	});

	it('preserves multiple successful chunks when a later chunk fails', async () => {
		// 6 keys, batch size 2 → 3 chunks; chunk 3 throws
		const sourceObj: Record<string, string> = {};
		for (let i = 0; i < 6; i++) {
			sourceObj[`key${i}`] = `value ${i}`;
		}

		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify(sourceObj),
		});

		let callCount = 0;
		const mockTranslate = vi.fn(
			async (items: TranslationItem[], targetLang: string) => {
				callCount++;
				if (callCount === 3) throw new Error('Third chunk failed');

				const result: Record<string, string> = {};
				for (const item of items) {
					result[item.key] = `[${targetLang}] ${item.value}`;
				}
				return result;
			},
		);

		await expect(runTranslation(config, fs, mockTranslate)).rejects.toThrow(
			'Third chunk failed',
		);

		const cache = JSON.parse(store.get('/cache/notes.de.json')!) as CacheFile;

		for (let i = 0; i < 4; i++) {
			expect(cache[`key${i}`]).toBeDefined();
			expect(cache[`key${i}`].translation).toBe(`[de] value ${i}`);
		}

		expect(cache['key4']).toBeUndefined();
		expect(cache['key5']).toBeUndefined();
	});
});
