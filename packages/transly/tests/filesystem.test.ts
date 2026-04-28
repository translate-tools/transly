/* eslint-disable @cspell/spellchecker */
import { fs as memfsFs, vol } from 'memfs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeHash, readCache, writeCache } from '../src/cache.js';
import { runTranslation } from '../src/runner.js';
import { scanNamespaces } from '../src/scanner.js';
import type { CacheFile, FsAdapter } from '../src/types.js';
import { makeConfig } from './stubs/makeConfig.js';
import { makeMockTranslate } from './stubs/makeTranslate.js';

/**
 * Wraps memfs in our FsAdapter interface.
 * Used only in this file because it depends on the memfs library.
 */
function makeMemfsAdapter(): FsAdapter {
	return {
		readFile: (path) =>
			new Promise<string>((resolve, reject) => {
				memfsFs.readFile(path, 'utf-8', (err, data) => {
					if (err || data === undefined)
						reject(err ?? new Error(`ENOENT: ${path}`));
					else resolve(data as string);
				});
			}),
		writeFile: (path, data) =>
			new Promise<void>((resolve, reject) => {
				memfsFs.writeFile(path, data, 'utf-8', (err) => {
					if (err) reject(err);
					else resolve();
				});
			}),
		mkdir: (path, options) =>
			new Promise<string | undefined>((resolve, reject) => {
				memfsFs.mkdir(path, options, (err) => {
					if (err && (err as NodeJS.ErrnoException).code !== 'EEXIST')
						reject(err);
					else resolve(undefined);
				});
			}),
		readdir: (path) =>
			new Promise<string[]>((resolve, reject) => {
				memfsFs.readdir(path, (err, files) => {
					if (err || files === undefined)
						reject(err ?? new Error(`ENOENT: ${path}`));
					else resolve(files as string[]);
				});
			}),
		access: (path) =>
			new Promise<void>((resolve, reject) => {
				memfsFs.access(path, (err) => {
					if (err) reject(err);
					else resolve();
				});
			}),
	};
}

beforeEach(() => {
	vol.reset();
});

afterEach(() => {
	vol.reset();
});

describe('Filesystem: scanNamespaces', () => {
	it('discovers JSON files in the source locale directory', async () => {
		vol.fromJSON({
			'/locales/en/notes.json': JSON.stringify({ title: 'Hello' }),
			'/locales/en/workspace.json': JSON.stringify({ name: 'Workspace' }),
		});

		const namespaces = await scanNamespaces('/locales', 'en', makeMemfsAdapter());

		expect(namespaces).toHaveLength(2);
		expect(namespaces.map((n) => n.namespace).sort()).toEqual(['notes', 'workspace']);
	});

	it('ignores non-JSON files', async () => {
		vol.fromJSON({
			'/locales/en/notes.json': JSON.stringify({ title: 'Hello' }),
			'/locales/en/README.md': '# Locales',
		});

		const namespaces = await scanNamespaces('/locales', 'en', makeMemfsAdapter());

		expect(namespaces).toHaveLength(1);
		expect(namespaces[0].namespace).toBe('notes');
	});

	it('throws when source locale directory does not exist', async () => {
		vol.fromJSON({});
		await expect(
			scanNamespaces('/locales', 'en', makeMemfsAdapter()),
		).rejects.toThrow();
	});

	it('parses JSON content correctly', async () => {
		const content = { title: 'Hello', nested: { message: 'World' } };
		vol.fromJSON({ '/locales/en/notes.json': JSON.stringify(content) });

		const namespaces = await scanNamespaces('/locales', 'en', makeMemfsAdapter());

		expect(namespaces[0].content).toEqual(content);
	});
});

describe('Filesystem: cache read/write', () => {
	it('writes cache file to disk and reads it back', async () => {
		vol.fromJSON({ '/cache/.keep': '' });
		const fs = makeMemfsAdapter();
		const cache: CacheFile = {
			title: { hash: computeHash('Hello'), translation: 'Hallo' },
		};

		await writeCache('/cache', 'notes', 'de', cache, fs);
		const result = await readCache('/cache', 'notes', 'de', fs);

		expect(result).toEqual(cache);
	});

	it('creates cache directory if it does not exist', async () => {
		vol.fromJSON({});
		const cache: CacheFile = {
			key: { hash: computeHash('value'), translation: 'Wert' },
		};

		await expect(
			writeCache('/cache', 'notes', 'de', cache, makeMemfsAdapter()),
		).resolves.not.toThrow();
	});

	it('returns empty cache when file does not exist', async () => {
		vol.fromJSON({});
		const result = await readCache('/cache', 'notes', 'de', makeMemfsAdapter());
		expect(result).toEqual({});
	});
});

describe('Filesystem: full pipeline with memfs', () => {
	it('reads source files, translates, and writes output files', async () => {
		vol.fromJSON({
			'/locales/en/notes.json': JSON.stringify({
				title: 'Hello',
				nested: { message: 'World' },
			}),
		});

		const fs = makeMemfsAdapter();
		await runTranslation(makeConfig(), fs, makeMockTranslate());

		const output = JSON.parse(await fs.readFile('/locales/de/notes.json', 'utf-8'));
		expect(output.title).toBe('[de] Hello');
		expect(output.nested.message).toBe('[de] World');
	});

	it('writes cache file after successful translation', async () => {
		vol.fromJSON({
			'/locales/en/notes.json': JSON.stringify({ title: 'Hello' }),
		});

		const fs = makeMemfsAdapter();
		await runTranslation(makeConfig(), fs, makeMockTranslate());

		const cache = JSON.parse(
			await fs.readFile('/cache/notes.de.json', 'utf-8'),
		) as CacheFile;

		expect(cache['title']).toBeDefined();
		expect(cache['title'].hash).toBe(computeHash('Hello'));
		expect(cache['title'].translation).toBe('[de] Hello');
	});

	it('does not call LLM on second run when nothing changed', async () => {
		vol.fromJSON({
			'/locales/en/notes.json': JSON.stringify({ title: 'Hello' }),
		});

		const fs = makeMemfsAdapter();
		const mockTranslate = makeMockTranslate();

		await runTranslation(makeConfig(), fs, mockTranslate);
		mockTranslate.mockClear();

		await runTranslation(makeConfig(), fs, mockTranslate);
		expect(mockTranslate).not.toHaveBeenCalled();
	});

	it('only retranslates updated keys on second run', async () => {
		vol.fromJSON({
			'/locales/en/notes.json': JSON.stringify({
				title: 'Hello',
				message: 'World',
			}),
		});

		const fs = makeMemfsAdapter();
		const mockTranslate = makeMockTranslate();

		await runTranslation(makeConfig(), fs, mockTranslate);
		mockTranslate.mockClear();

		await fs.writeFile(
			'/locales/en/notes.json',
			JSON.stringify({ title: 'Hello Updated', message: 'World' }),
			'utf-8',
		);

		const callLog: { items: { key: string }[] }[] = [];
		const retryTranslate = makeMockTranslate(callLog as never);

		await runTranslation(makeConfig(), fs, retryTranslate);

		expect(retryTranslate).toHaveBeenCalledTimes(1);
		expect(callLog[0].items).toHaveLength(1);
		expect(callLog[0].items[0].key).toBe('title');
	});

	it('handles multiple namespaces correctly', async () => {
		vol.fromJSON({
			'/locales/en/notes.json': JSON.stringify({ title: 'Note' }),
			'/locales/en/workspace.json': JSON.stringify({ name: 'Workspace' }),
		});

		const fs = makeMemfsAdapter();
		await runTranslation(makeConfig(), fs, makeMockTranslate());

		expect(
			JSON.parse(await fs.readFile('/locales/de/notes.json', 'utf-8')).title,
		).toBe('[de] Note');
		expect(
			JSON.parse(await fs.readFile('/locales/de/workspace.json', 'utf-8')).name,
		).toBe('[de] Workspace');
	});

	it('preserves existing target file keys not in source', async () => {
		vol.fromJSON({
			'/locales/en/notes.json': JSON.stringify({ title: 'Hello' }),
			'/locales/de/notes.json': JSON.stringify({ legacy: 'Altes Feld' }),
		});

		const fs = makeMemfsAdapter();
		await runTranslation(makeConfig(), fs, makeMockTranslate());

		const output = JSON.parse(await fs.readFile('/locales/de/notes.json', 'utf-8'));
		expect(output.title).toBe('[de] Hello');
		expect(output.legacy).toBe('Altes Feld');
	});
});
