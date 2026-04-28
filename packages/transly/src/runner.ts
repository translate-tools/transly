import { join } from 'path';

import { computeHash, getChangedKeys, readCache, writeCache } from './cache.js';
import { chunkItems, DEFAULT_MAX_BATCH_SIZE } from './chunker.js';
import { DEFAULT_CONCURRENCY, runWithConcurrency } from './concurrency.js';
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
	/**
	 * Fired once after scanning, before any translation begins.
	 * Carries the complete picture of what needs to be done.
	 */
	| {
			type: 'scan_complete';
			/** Number of source namespace files found */
			namespaces: number;
			/** Number of target languages */
			targetLangs: number;
			/** Total (namespace × targetLang) task count */
			totalTasks: number;
			/** Sum of all source keys across all namespaces */
			totalKeys: number;
	  }
	/**
	 * Fired when a (namespace, targetLang) task begins.
	 */
	| {
			type: 'task_start';
			namespace: string;
			targetLang: string;
			/** Total number of flat keys in the source namespace */
			totalKeys: number;
			/** Number of keys that differ from the cache (need translation) */
			changedKeys: number;
	  }
	/**
	 * Fired after each LLM chunk within a task completes successfully.
	 */
	| {
			type: 'chunk_done';
			namespace: string;
			targetLang: string;
			chunkIndex: number;
			totalChunks: number;
			/** Number of keys translated in this specific chunk */
			chunkSize: number;
	  }
	/**
	 * Fired when a (namespace, targetLang) task is fully translated and written.
	 */
	| { type: 'task_done'; namespace: string; targetLang: string }
	/**
	 * Fired when a (namespace, targetLang) task has no changed keys and is
	 * skipped (target file is still (re)written from cache).
	 */
	| { type: 'task_skip'; namespace: string; targetLang: string };

/**
 * Merges cached translations with the existing target locale file and writes
 * the result. Only keys present in the source are written; unrelated keys
 * already in the target file are preserved.
 */
async function writeTargetFile(
	config: Config,
	namespace: string,
	targetLang: string,
	flatSource: Record<string, unknown>,
	cache: CacheFile,
	fs: FsAdapter,
): Promise<void> {
	const targetDir = join(config.localesDir, targetLang);
	const targetPath = join(targetDir, `${namespace}.json`);

	// Read existing target file (if any) to preserve unrelated keys
	let existingFlat: Record<string, unknown> = {};
	try {
		await fs.access(targetPath);
		const raw = await fs.readFile(targetPath, 'utf-8');
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		existingFlat = flattenJson(parsed);
	} catch {
		// File doesn't exist yet — start fresh
	}

	// Merge: start from existing, then overlay translations from cache
	const merged: Record<string, unknown> = { ...existingFlat };

	for (const key of Object.keys(flatSource)) {
		const entry = cache[key];
		const translation = entry?.translation;
		merged[key] = translation;
	}

	// Reconstruct nested JSON and write
	const nested = unflattenJson(merged);
	await fs.mkdir(targetDir, { recursive: true });
	await fs.writeFile(targetPath, JSON.stringify(nested, null, 2), 'utf-8');
}

/**
 * Translates a single (namespace × targetLang) task.
 *
 * Chunks are processed sequentially so that partial-failure safety is
 * maintained: the cache is written after each successful chunk, and an error
 * in later chunk leaves prior chunks persisted.
 */
async function runTask(
	config: Config,
	namespace: string,
	targetLang: string,
	flatSource: Record<string, unknown>,
	maxBatchSize: number,
	fs: FsAdapter,
	translateFn: typeof translateChunk,
	onProgress?: ProgressCallback,
): Promise<void> {
	// Load existing cache
	const cache = await readCache(config.cacheDir, namespace, targetLang, fs);

	// Detect changed keys
	const changedKeys = getChangedKeys(flatSource, cache);

	onProgress?.({
		type: 'task_start',
		namespace,
		targetLang,
		totalKeys: Object.keys(flatSource).length,
		changedKeys: changedKeys.length,
	});

	if (changedKeys.length === 0) {
		onProgress?.({ type: 'task_skip', namespace, targetLang });
		// Still need to write the output file from cache
		await writeTargetFile(config, namespace, targetLang, flatSource, cache, fs);
		return;
	}

	// Build items and split into chunks
	const items: TranslationItem[] = changedKeys.map((key) => ({
		key,
		value: String(flatSource[key]),
	}));

	const chunks = chunkItems(items, maxBatchSize);

	// Translate chunk by chunk, persisting cache after each success
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
			chunkSize: chunk.length,
		});
	}

	// Write merged target locale file
	await writeTargetFile(config, namespace, targetLang, flatSource, cache, fs);

	onProgress?.({ type: 'task_done', namespace, targetLang });
}

/**
 * Main translation pipeline.
 *
 * For each namespace × target language (concurrently, up to `concurrency`
 * workers running at once):
 *   1. Flatten source JSON
 *   2. Load cache
 *   3. Detect changed keys
 *   4. Split into chunks
 *   5. Call LLM per chunk (cache written after each successful chunk)
 *   6. Merge translations back into target locale file
 *
 * Partial failure safety: if a chunk fails, all previously processed chunks
 * for that namespace+lang are already persisted in the cache.  Tasks that are
 * already in-flight when an error occurs are allowed to complete.  The first
 * error encountered is re-thrown after all in-flight tasks settle.
 *
 * @param config      - Validated user configuration
 * @param fs          - Filesystem adapter (defaults to Node's fs/promises)
 * @param translateFn - LLM translation function (injectable for testing)
 * @param onProgress  - Optional progress callback
 */
export async function runTranslation(
	config: Config,
	fs: FsAdapter = makeNodeFsAdapter(),
	translateFn: typeof translateChunk = translateChunk,
	onProgress?: ProgressCallback,
): Promise<void> {
	const maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
	const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;

	// 1. Discover all source namespace files
	const namespaces = await scanNamespaces(config.localesDir, config.sourceLang, fs);

	// 2. Pre-flatten all source files and compute summary stats
	const namespacesWithFlat = namespaces.map(({ namespace, content }) => ({
		namespace,
		flatSource: flattenJson(content),
	}));

	const totalKeys = namespacesWithFlat.reduce(
		(sum, { flatSource }) => sum + Object.keys(flatSource).length,
		0,
	);

	onProgress?.({
		type: 'scan_complete',
		namespaces: namespaces.length,
		targetLangs: config.targetLangs.length,
		totalTasks: namespaces.length * config.targetLangs.length,
		totalKeys,
	});

	// 3. Build a flat list of all (namespace × targetLang) task thunks
	const tasks: Array<() => Promise<void>> = [];

	for (const { namespace, flatSource } of namespacesWithFlat) {
		for (const targetLang of config.targetLangs) {
			tasks.push(() =>
				runTask(
					config,
					namespace,
					targetLang,
					flatSource,
					maxBatchSize,
					fs,
					translateFn,
					onProgress,
				),
			);
		}
	}

	// 4. Run all tasks with bounded concurrency
	await runWithConcurrency(tasks, concurrency);
}
