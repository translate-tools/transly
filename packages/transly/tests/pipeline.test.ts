import { describe, expect, it } from 'vitest';

import { computeHash } from '../src/cache.js';
import { runTranslation } from '../src/runner.js';
import type { CacheFile } from '../src/types.js';
import { makeConfig } from './stubs/makeConfig.js';
import { makeMemFs } from './stubs/makeMemFs.js';
import { makeMockTranslate, type TranslateCallLog } from './stubs/makeTranslate.js';

describe('Full translation pipeline', () => {
	it('translates all keys when cache is empty', async () => {
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

		const callLog: TranslateCallLog[] = [];
		await runTranslation(makeConfig(), fs, makeMockTranslate(callLog));

		expect(callLog).toHaveLength(1);
		expect(callLog[0].targetLang).toBe('de');
		expect(callLog[0].items).toHaveLength(7);

		expect(JSON.parse(store.get('/locales/de/notes.json')!)).toStrictEqual({
			title: '[de] Hello',
			message: '[de] World',
			tags: ['[de] Ideas', '[de] Health', '[de] Well Being'],
			'foo.bar': '[de] Name with dots',
			foo: {
				bar: '[de] Another value',
			},
		});

		expect(store).toMatchSnapshot('Storage state');
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

	it('only retranslates changed keys', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({
				title: 'Hello',
				message: 'World',
			}),
		});

		const callLog: TranslateCallLog[] = [];
		const mockTranslate = makeMockTranslate(callLog);

		await runTranslation(makeConfig(), fs, mockTranslate);
		mockTranslate.mockClear();
		callLog.length = 0;

		store.set(
			'/locales/en/notes.json',
			JSON.stringify({ title: 'Hello Updated', message: 'World' }),
		);

		await runTranslation(makeConfig(), fs, mockTranslate);

		expect(mockTranslate).toHaveBeenCalledTimes(1);
		expect(callLog[0].items).toHaveLength(1);
		expect(callLog[0].items[0].key).toBe('title');
	});

	it('splits large input into multiple chunks', async () => {
		const sourceObj: Record<string, string> = {};
		for (let i = 0; i < 25; i++) {
			sourceObj[`key${i}`] = `value ${i}`;
		}

		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify(sourceObj),
		});

		const callLog: TranslateCallLog[] = [];
		await runTranslation(
			makeConfig({ maxBatchSize: 10 }),
			fs,
			makeMockTranslate(callLog),
		);

		expect(callLog).toHaveLength(3);
		expect(callLog[0].items).toHaveLength(10);
		expect(callLog[1].items).toHaveLength(10);
		expect(callLog[2].items).toHaveLength(5);
	});

	it('translates multiple namespaces', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ title: 'Note' }),
			'/locales/en/workspace.json': JSON.stringify({ name: 'Workspace' }),
		});

		const callLog: TranslateCallLog[] = [];
		await runTranslation(makeConfig(), fs, makeMockTranslate(callLog));

		expect(callLog).toHaveLength(2);
	});

	it('translates multiple target languages', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ title: 'Hello' }),
		});

		const callLog: TranslateCallLog[] = [];
		await runTranslation(
			makeConfig({ targetLangs: ['de', 'fr'] }),
			fs,
			makeMockTranslate(callLog),
		);

		expect(callLog).toHaveLength(2);
		expect(callLog.map((c) => c.targetLang).sort()).toEqual(['de', 'fr']);
	});

	it('preserves existing unrelated keys in target file', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ title: 'Hello' }),
			'/locales/de/notes.json': JSON.stringify({ unrelated: 'Existing' }),
		});

		await runTranslation(makeConfig(), fs, makeMockTranslate());

		const output = JSON.parse(store.get('/locales/de/notes.json')!);
		expect(output.title).toBe('[de] Hello');
		expect(output.unrelated).toBe('Existing');
	});

	it('writes cache after translation', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ title: 'Hello' }),
		});

		await runTranslation(makeConfig(), fs, makeMockTranslate());

		expect(store.has('/cache/notes.de.json')).toBe(true);
		const cache = JSON.parse(store.get('/cache/notes.de.json')!) as CacheFile;
		expect(cache['title']).toBeDefined();
		expect(cache['title'].hash).toBe(computeHash('Hello'));
		expect(cache['title'].translation).toBe('[de] Hello');
	});

	it('handles nested source JSON correctly', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({
				editor: { placeholder: 'Type here', title: 'Editor' },
			}),
		});

		await runTranslation(makeConfig(), fs, makeMockTranslate());

		const output = JSON.parse(store.get('/locales/de/notes.json')!);
		expect(output.editor.placeholder).toBe('[de] Type here');
		expect(output.editor.title).toBe('[de] Editor');
	});
});
