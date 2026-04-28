import { describe, expect, it } from 'vitest';

import { computeHash } from '../src/cache';
import { runTranslation } from '../src/runner';
import type { CacheFile } from '../src/types';
import { makeConfig } from './stubs/makeConfig';
import { makeMemFs } from './stubs/makeMemFs';
import { makeMockTranslate, type TranslateCallLog } from './stubs/makeTranslate';

// ─── Core translation correctness ────────────────────────────────────────────

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

// ─── Progress events ──────────────────────────────────────────────────────────

describe('Progress events', () => {
	it('emits scan_complete with correct counts', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ a: '1', b: '2' }),
			'/locales/en/workspace.json': JSON.stringify({ c: '3' }),
		});

		const events: unknown[] = [];
		await runTranslation(
			makeConfig({ targetLangs: ['de', 'fr'] }),
			fs,
			makeMockTranslate(),
			(e) => events.push(e),
		);

		const scanEvent = events.find(
			(e) => (e as { type: string }).type === 'scan_complete',
		) as {
			type: 'scan_complete';
			namespaces: number;
			targetLangs: number;
			totalTasks: number;
			totalKeys: number;
		};

		expect(scanEvent).toBeDefined();
		expect(scanEvent.namespaces).toBe(2);
		expect(scanEvent.targetLangs).toBe(2);
		expect(scanEvent.totalTasks).toBe(4); // 2 ns × 2 langs
		expect(scanEvent.totalKeys).toBe(3); // 2 + 1
	});

	it('emits scan_complete as the very first event', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ a: '1' }),
		});

		const events: string[] = [];
		await runTranslation(makeConfig(), fs, makeMockTranslate(), (e) =>
			events.push(e.type),
		);

		expect(events[0]).toBe('scan_complete');
	});

	it('emits task_start and task_done for each (namespace × targetLang) pair', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ a: '1' }),
			'/locales/en/workspace.json': JSON.stringify({ b: '2' }),
		});

		const starts: string[] = [];
		const done: string[] = [];

		await runTranslation(
			makeConfig({ targetLangs: ['de', 'fr'] }),
			fs,
			makeMockTranslate(),
			(e) => {
				if (e.type === 'task_start')
					starts.push(`${e.targetLang}:${e.namespace}`);
				if (e.type === 'task_done') done.push(`${e.targetLang}:${e.namespace}`);
			},
		);

		expect(starts).toHaveLength(4); // 2 ns × 2 langs
		expect(done).toHaveLength(4);
	});

	it('emits task_skip instead of task_done when no keys changed', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ a: '1' }),
		});

		// First run — primes the cache
		await runTranslation(makeConfig(), fs, makeMockTranslate());

		const skips: string[] = [];
		const done: string[] = [];

		// Second run — nothing changed, so task_skip should fire
		await runTranslation(makeConfig(), fs, makeMockTranslate(), (e) => {
			if (e.type === 'task_skip') skips.push(`${e.targetLang}:${e.namespace}`);
			if (e.type === 'task_done') done.push(`${e.targetLang}:${e.namespace}`);
		});

		expect(skips).toHaveLength(1);
		expect(skips[0]).toBe('de:notes');
		expect(done).toHaveLength(0);
	});

	it('emits chunk_done with correct chunkSize for each chunk', async () => {
		const sourceObj: Record<string, string> = {};
		for (let i = 0; i < 25; i++) sourceObj[`key${i}`] = `value ${i}`;

		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify(sourceObj),
		});

		const chunkEvents: Array<{
			chunkIndex: number;
			totalChunks: number;
			chunkSize: number;
		}> = [];

		await runTranslation(
			makeConfig({ maxBatchSize: 10 }),
			fs,
			makeMockTranslate(),
			(e) => {
				if (e.type === 'chunk_done') {
					chunkEvents.push({
						chunkIndex: e.chunkIndex,
						totalChunks: e.totalChunks,
						chunkSize: e.chunkSize,
					});
				}
			},
		);

		expect(chunkEvents).toHaveLength(3);
		expect(chunkEvents[0]).toMatchObject({
			chunkIndex: 0,
			totalChunks: 3,
			chunkSize: 10,
		});
		expect(chunkEvents[1]).toMatchObject({
			chunkIndex: 1,
			totalChunks: 3,
			chunkSize: 10,
		});
		expect(chunkEvents[2]).toMatchObject({
			chunkIndex: 2,
			totalChunks: 3,
			chunkSize: 5,
		});
	});

	it('task_start reports correct totalKeys and changedKeys', async () => {
		const { fs } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ a: '1', b: '2', c: '3' }),
		});

		const taskStarts: Array<{ totalKeys: number; changedKeys: number }> = [];

		await runTranslation(makeConfig(), fs, makeMockTranslate(), (e) => {
			if (e.type === 'task_start') {
				taskStarts.push({ totalKeys: e.totalKeys, changedKeys: e.changedKeys });
			}
		});

		expect(taskStarts).toHaveLength(1);
		expect(taskStarts[0]).toEqual({ totalKeys: 3, changedKeys: 3 });
	});
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

describe('Concurrency', () => {
	it('runs tasks concurrently when concurrency > 1', async () => {
		// 3 namespaces × 1 language = 3 tasks.
		// With concurrency=3, all 3 should start before any finishes.
		// We gate them with a barrier: if they were sequential the barrier
		// would never resolve.
		const { fs } = makeMemFs({
			'/locales/en/a.json': JSON.stringify({ k: '1' }),
			'/locales/en/b.json': JSON.stringify({ k: '2' }),
			'/locales/en/c.json': JSON.stringify({ k: '3' }),
		});

		let inflight = 0;
		let maxInflight = 0;
		const TOTAL = 3;

		// Build a per-task latch: each translate call increments inflight and
		// waits for all others to also be in-flight before returning.
		let started = 0;
		let resolveAll!: () => void;
		const allStarted = new Promise<void>((r) => (resolveAll = r));

		const concurrentTranslate = async (
			items: { key: string; value: string }[],
			targetLang: string,
		) => {
			inflight++;
			maxInflight = Math.max(maxInflight, inflight);
			started++;
			if (started >= TOTAL) resolveAll();
			await allStarted;
			inflight--;

			const result: Record<string, string> = {};
			for (const item of items) {
				result[item.key] = `[${targetLang}] ${item.value}`;
			}
			return result;
		};

		await runTranslation(makeConfig({ concurrency: 3 }), fs, concurrentTranslate);

		expect(maxInflight).toBe(3);
	});

	it('respects the concurrency limit across (namespace × targetLang) tasks', async () => {
		// 6 tasks total (3 ns × 2 lang), concurrency = 2
		const { fs } = makeMemFs({
			'/locales/en/a.json': JSON.stringify({ k: '1' }),
			'/locales/en/b.json': JSON.stringify({ k: '2' }),
			'/locales/en/c.json': JSON.stringify({ k: '3' }),
		});

		let inflight = 0;
		let maxInflight = 0;

		const trackingTranslate = async (
			items: { key: string; value: string }[],
			targetLang: string,
		) => {
			inflight++;
			maxInflight = Math.max(maxInflight, inflight);
			await new Promise<void>((r) => setImmediate(r));
			inflight--;

			const result: Record<string, string> = {};
			for (const item of items) {
				result[item.key] = `[${targetLang}] ${item.value}`;
			}
			return result;
		};

		await runTranslation(
			makeConfig({ targetLangs: ['de', 'fr'], concurrency: 2 }),
			fs,
			trackingTranslate,
		);

		expect(maxInflight).toBeLessThanOrEqual(2);
		expect(maxInflight).toBeGreaterThan(0);
	});

	it('completes all tasks successfully regardless of concurrency level', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/a.json': JSON.stringify({ x: 'A' }),
			'/locales/en/b.json': JSON.stringify({ y: 'B' }),
		});

		await runTranslation(
			makeConfig({ targetLangs: ['de', 'fr'], concurrency: 4 }),
			fs,
			makeMockTranslate(),
		);

		// All 4 output files must exist
		expect(JSON.parse(store.get('/locales/de/a.json')!)).toMatchObject({
			x: '[de] A',
		});
		expect(JSON.parse(store.get('/locales/fr/a.json')!)).toMatchObject({
			x: '[fr] A',
		});
		expect(JSON.parse(store.get('/locales/de/b.json')!)).toMatchObject({
			y: '[de] B',
		});
		expect(JSON.parse(store.get('/locales/fr/b.json')!)).toMatchObject({
			y: '[fr] B',
		});
	});

	it('uses concurrency=1 as effectively sequential (output is deterministic)', async () => {
		const { fs, store } = makeMemFs({
			'/locales/en/notes.json': JSON.stringify({ title: 'Hello', body: 'World' }),
		});

		const callLog: TranslateCallLog[] = [];
		await runTranslation(
			makeConfig({ concurrency: 1 }),
			fs,
			makeMockTranslate(callLog),
		);

		expect(callLog).toHaveLength(1);
		expect(JSON.parse(store.get('/locales/de/notes.json')!)).toMatchObject({
			title: '[de] Hello',
			body: '[de] World',
		});
	});
});
