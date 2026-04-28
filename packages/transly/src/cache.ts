import { createHash } from 'crypto';
import { join } from 'path';

import type { CacheFile, FsAdapter } from './types.js';

/**
 * Computes the SHA-256 hash of a string value.
 * Used to detect whether a source string has changed since last translation.
 */
export function computeHash(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Builds the filesystem path for a namespace+language cache file.
 *
 * @param cacheDir - Root cache directory
 * @param namespace - Namespace name (e.g. "features")
 * @param targetLang - Target language code (e.g. "de")
 */
export function getCacheFilePath(
	cacheDir: string,
	namespace: string,
	targetLang: string,
): string {
	return join(cacheDir, `${namespace}.${targetLang}.json`);
}

/**
 * Reads and parses a cache file from disk.
 * Returns an empty object if the file does not exist.
 */
export async function readCache(
	cacheDir: string,
	namespace: string,
	targetLang: string,
	fs: FsAdapter,
): Promise<CacheFile> {
	const filePath = getCacheFilePath(cacheDir, namespace, targetLang);

	try {
		await fs.access(filePath);
	} catch {
		// File does not exist — return empty cache
		return {};
	}

	try {
		const raw = await fs.readFile(filePath, 'utf-8');
		return JSON.parse(raw) as CacheFile;
	} catch (err) {
		throw new Error(
			`Failed to read cache file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Writes the cache object to disk as JSON.
 * Creates the cache directory if it does not exist.
 */
export async function writeCache(
	cacheDir: string,
	namespace: string,
	targetLang: string,
	cache: CacheFile,
	fs: FsAdapter,
): Promise<void> {
	await fs.mkdir(cacheDir, { recursive: true });
	const filePath = getCacheFilePath(cacheDir, namespace, targetLang);
	await fs.writeFile(filePath, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Compares a flat source map against the cache and returns the keys that need
 * (re-)translation:
 *   - key is new (not in cache), OR
 *   - hash of source value has changed
 */
export function getChangedKeys(
	flatSource: Record<string, string>,
	cache: CacheFile,
): string[] {
	const changed: string[] = [];

	for (const [key, value] of Object.entries(flatSource)) {
		const entry = cache[key];
		const hash = computeHash(value);

		if (!entry || entry.hash !== hash) {
			changed.push(key);
		}
	}

	return changed;
}
