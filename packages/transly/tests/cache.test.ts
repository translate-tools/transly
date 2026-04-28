import { describe, expect, it } from 'vitest';

import { computeHash, getChangedKeys, readCache, writeCache } from '../src/cache.js';
import type { CacheFile } from '../src/types.js';
import { makeSimpleMemFs } from './stubs/makeMemFs.js';

describe('computeHash', () => {
	it('returns a 64-character hex string (SHA-256)', () => {
		const hash = computeHash('hello');
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]+$/);
	});

	it('returns the same hash for the same input', () => {
		expect(computeHash('hello')).toBe(computeHash('hello'));
	});

	it('returns different hashes for different inputs', () => {
		expect(computeHash('hello')).not.toBe(computeHash('world'));
	});

	it('is sensitive to whitespace', () => {
		expect(computeHash('hello')).not.toBe(computeHash('hello '));
	});

	it('handles empty string', () => {
		expect(computeHash('')).toHaveLength(64);
	});
});

describe('readCache', () => {
	it('returns empty object when cache file does not exist', async () => {
		const fs = makeSimpleMemFs();
		const result = await readCache('/cache', 'features', 'de', fs);
		expect(result).toEqual({});
	});

	it('reads and parses an existing cache file', async () => {
		const cacheData: CacheFile = {
			greeting: {
				hash: computeHash('Hello'),
				translation: 'Hallo',
			},
		};
		const fs = makeSimpleMemFs({
			'/cache/features.de.json': JSON.stringify(cacheData),
		});

		const result = await readCache('/cache', 'features', 'de', fs);
		expect(result).toEqual(cacheData);
	});

	it('throws on malformed JSON in cache file', async () => {
		const fs = makeSimpleMemFs({ '/cache/features.de.json': 'not-json{{{' });
		await expect(readCache('/cache', 'features', 'de', fs)).rejects.toThrow();
	});
});

describe('writeCache', () => {
	it('writes cache as formatted JSON', async () => {
		const fs = makeSimpleMemFs();
		const cache: CacheFile = {
			greeting: {
				hash: computeHash('Hello'),
				translation: 'Hallo',
			},
		};

		await writeCache('/cache', 'features', 'de', cache, fs);

		const written = await fs.readFile('/cache/features.de.json', 'utf-8');
		expect(JSON.parse(written)).toEqual(cache);
	});

	it('round-trips: write then read returns same data', async () => {
		const fs = makeSimpleMemFs();
		const cache: CacheFile = {
			title: {
				hash: computeHash('Hello'),
				translation: 'Hallo',
			},
			'nested.message': {
				hash: computeHash('World'),
				translation: 'Hallo',
			},
		};

		await writeCache('/cache', 'ns', 'de', cache, fs);
		const result = await readCache('/cache', 'ns', 'de', fs);
		expect(result).toEqual(cache);
	});
});

describe('getChangedKeys', () => {
	it('returns all keys when cache is empty', () => {
		const flat = { title: 'Hello', message: 'World' };
		const changed = getChangedKeys(flat, {});
		expect(changed).toEqual(expect.arrayContaining(['title', 'message']));
		expect(changed).toHaveLength(2);
	});

	it('returns no keys when all are cached with correct hashes', () => {
		const flat = { title: 'Hello' };
		const cache: CacheFile = {
			title: { hash: computeHash('Hello'), translation: 'Hallo' },
		};

		const changed = getChangedKeys(flat, cache);
		expect(changed).toHaveLength(0);
	});

	it('returns key when hash has changed', () => {
		const flat = { title: 'Hello Updated' };
		const cache: CacheFile = {
			title: { hash: computeHash('Hello'), translation: 'Hallo' },
		};

		const changed = getChangedKeys(flat, cache);
		expect(changed).toContain('title');
	});

	it('does not return key when only another language is missing', () => {
		const flat = { title: 'Hello' };
		const cache: CacheFile = {
			title: { hash: computeHash('Hello'), translation: 'Hallo' },
		};

		const changed = getChangedKeys(flat, cache);
		expect(changed).toHaveLength(0);
	});

	it('returns only changed keys in a mixed scenario', () => {
		const flat = {
			title: 'Hello',
			message: 'World Updated',
			newKey: 'New',
		};
		const cache: CacheFile = {
			title: { hash: computeHash('Hello'), translation: 'Hallo' },
			message: { hash: computeHash('World'), translation: 'Hallo' },
		};

		const changed = getChangedKeys(flat, cache);
		expect(changed).not.toContain('title');
		expect(changed).toContain('message');
		expect(changed).toContain('newKey');
	});
});
