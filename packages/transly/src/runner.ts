import { join } from 'path';

import { computeHash, getChangedKeys, readCache, writeCache } from './cache.js';
import { chunkItems, DEFAULT_MAX_BATCH_SIZE } from './chunker.js';
import { flattenJson, unflattenJson } from './flatten.js';
import { translateChunk } from './llm.js';
import { scanNamespaces } from './scanner.js';
import type { CacheFile, Config, FsAdapter, TranslationItem } from './types.js';
import { makeNodeFsAdapter } from './utils/makeNodeFsAdapter.js';

/**
 * Progress callback invoked at key milestones during translation.
 */
export type ProgressCallback = (event: ProgressEvent) => void;

export type ProgressEvent =
	| {
			type: 'namespace_start';
			namespace: string;
			targetLang: string;
			totalKeys: number;
			changedKeys: number;
	  }
	| {
			type: 'chunk_done';
			namespace: string;
			targetLang: string;
			chunkIndex: number;
			totalChunks: number;
	  }
	| { type: 'namespace_done'; namespace: string; targetLang: string }
	| { type: 'no_changes'; namespace: string; targetLang: string };

/**
 * Merges cached translations with the existing target locale file and writes
 * the result. Only keys present in the source are written; unrelated keys
 * already in the target file are preserved.
 */
async function writeTargetFile(
	config: Config,
	namespace: string,
	targetLang: string,
	flatSource: Record<string, string>,
	cache: CacheFile,
	fs: FsAdapter,
): Promise<void> {
	const targetDir = join(config.localesDir, targetLang);
	const targetPath = join(targetDir, `${namespace}.json`);

	// Read existing target file (if any) to preserve unrelated keys
	let existingFlat: Record<string, string> = {};
	try {
		await fs.access(targetPath);
		const raw = await fs.readFile(targetPath, 'utf-8');
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		existingFlat = flattenJson(parsed);
	} catch {
		// File doesn't exist yet — start fresh
	}

	// Merge: start from existing, then overlay translations from cache
	const merged: Record<string, string> = { ...existingFlat };

	for (const key of Object.keys(flatSource)) {
		const entry = cache[key];
		const translation = entry?.translation;
		if (translation !== undefined) {
			merged[key] = translation;
		}
	}

	// Reconstruct nested JSON and write
	const nested = unflattenJson(merged);
	await fs.mkdir(targetDir, { recursive: true });
	await fs.writeFile(targetPath, JSON.stringify(nested, null, 2), 'utf-8');
}

/**
 * Main translation pipeline.
 *
 * For each namespace × target language:
 *   1. Flatten source JSON
 *   2. Load cache
 *   3. Detect changed keys
 *   4. Split into chunks
 *   5. Call LLM per chunk (cache written after each successful chunk)
 *   6. Merge translations back into target locale file
 *
 * Partial failure safety: if a chunk fails, all previously processed chunks
 * for that namespace+lang are already persisted in the cache. The error is
 * re-thrown so the caller can decide how to handle it.
 *
 * @param config - Validated user configuration
 * @param fs - Filesystem adapter (defaults to Node's fs/promises)
 * @param translateFn - LLM translation function (injectable for testing)
 * @param onProgress - Optional progress callback
 */
export async function runTranslation(
	config: Config,
	fs: FsAdapter = makeNodeFsAdapter(),
	translateFn: typeof translateChunk = translateChunk,
	onProgress?: ProgressCallback,
): Promise<void> {
	const maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;

	// 1. Discover all source namespace files
	const namespaces = await scanNamespaces(config.localesDir, config.sourceLang, fs);

	for (const { namespace, content } of namespaces) {
		// 2. Flatten source JSON
		const flatSource = flattenJson(content);

		for (const targetLang of config.targetLangs) {
			// 3. Load existing cache
			const cache = await readCache(config.cacheDir, namespace, targetLang, fs);

			// 4. Detect changed keys
			const changedKeys = getChangedKeys(flatSource, cache);

			onProgress?.({
				type: 'namespace_start',
				namespace,
				targetLang,
				totalKeys: Object.keys(flatSource).length,
				changedKeys: changedKeys.length,
			});

			if (changedKeys.length === 0) {
				onProgress?.({ type: 'no_changes', namespace, targetLang });
				// Still need to write the output file from cache
				await writeTargetFile(
					config,
					namespace,
					targetLang,
					flatSource,
					cache,
					fs,
				);
				continue;
			}

			// 5. Build items and split into chunks
			const items: TranslationItem[] = changedKeys.map((key) => ({
				key,
				value: flatSource[key],
			}));

			const chunks = chunkItems(items, maxBatchSize);

			// 6. Translate chunk by chunk, persisting cache after each success
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];

				// translateFn may throw — let it propagate; cache already has prior chunks
				const translations = await translateFn(chunk, targetLang, config);

				// Update cache entries for this chunk
				for (const item of chunk) {
					const hash = computeHash(item.value);

					cache[item.key] = {
						hash,
						translation: translations[item.key],
					};
				}

				// Persist cache immediately after each successful chunk
				await writeCache(config.cacheDir, namespace, targetLang, cache, fs);

				onProgress?.({
					type: 'chunk_done',
					namespace,
					targetLang,
					chunkIndex: i,
					totalChunks: chunks.length,
				});
			}

			// 7. Write merged target locale file
			await writeTargetFile(config, namespace, targetLang, flatSource, cache, fs);

			onProgress?.({ type: 'namespace_done', namespace, targetLang });
		}
	}
}
