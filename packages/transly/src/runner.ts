import { join } from 'path';

import {
	computeHash,
	getCacheDir,
	getChangedKeys,
	readCache,
	writeCache,
} from './cache.js';
import { chunkItems, DEFAULT_MAX_BATCH_SIZE } from './chunker.js';
import { DEFAULT_CONCURRENCY, runWithConcurrency } from './concurrency.js';
import { flattenJson, unflattenJson } from './flatten.js';
import { translateChunk } from './llm.js';
import { scanNamespaces } from './scanner.js';
import type { CacheFile, Config, FsAdapter, TranslationItem } from './types.js';
import { makeNodeFsAdapter } from './utils/makeNodeFsAdapter.js';

export type ProgressCallback = (event: ProgressEvent) => void;

export type ProgressEvent =
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
	| {
			type: 'task_start';
			namespace: string;
			targetLang: string;
			/** Total number of flat keys in the source namespace */
			totalKeys: number;
			/** Number of keys that differ from the cache (need translation) */
			changedKeys: number;
	  }
	| {
			type: 'chunk_done';
			namespace: string;
			targetLang: string;
			chunkIndex: number;
			totalChunks: number;
			/** Number of keys translated in this specific chunk */
			chunkSize: number;
	  }
	| { type: 'task_done'; namespace: string; targetLang: string }
	| { type: 'task_skip'; namespace: string; targetLang: string };

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

	let existingFlat: Record<string, unknown> = {};
	try {
		await fs.access(targetPath);
		const raw = await fs.readFile(targetPath, 'utf-8');
		existingFlat = flattenJson(JSON.parse(raw) as Record<string, unknown>);
	} catch {
		// file doesn't exist yet
	}

	const merged: Record<string, unknown> = { ...existingFlat };
	for (const key of Object.keys(flatSource)) {
		merged[key] = cache[key]?.translation;
	}

	const nested = unflattenJson(merged);
	await fs.mkdir(targetDir, { recursive: true });
	await fs.writeFile(targetPath, JSON.stringify(nested, null, 2), 'utf-8');
}

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
	const cacheDir = getCacheDir(config);
	const cache = await readCache(cacheDir, namespace, targetLang, fs);
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
		await writeTargetFile(config, namespace, targetLang, flatSource, cache, fs);
		return;
	}

	const items: TranslationItem[] = changedKeys.map((key) => ({
		key,
		value: String(flatSource[key]),
	}));

	const chunks = chunkItems(items, maxBatchSize);

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];

		// translateFn may throw — cache already has prior chunks persisted
		const translations = await translateFn(chunk, targetLang, config);

		for (const item of chunk) {
			cache[item.key] = {
				hash: computeHash(item.value),
				translation: translations[item.key],
			};
		}

		await writeCache(cacheDir, namespace, targetLang, cache, fs);

		onProgress?.({
			type: 'chunk_done',
			namespace,
			targetLang,
			chunkIndex: i,
			totalChunks: chunks.length,
			chunkSize: chunk.length,
		});
	}

	await writeTargetFile(config, namespace, targetLang, flatSource, cache, fs);
	onProgress?.({ type: 'task_done', namespace, targetLang });
}

/**
 * Main translation pipeline.
 *
 * Translates every namespace × target language pair concurrently (up to
 * `config.concurrency` workers). Chunks within each task are sequential so
 * that partial-failure cache safety is preserved: if a chunk throws, all
 * previously written chunks for that task remain in the cache. Tasks already
 * in-flight when an error occurs are allowed to complete before the first
 * error is re-thrown.
 */
export async function runTranslation(
	config: Config,
	fs: FsAdapter = makeNodeFsAdapter(),
	translateFn: typeof translateChunk = translateChunk,
	onProgress?: ProgressCallback,
): Promise<void> {
	const maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
	const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;

	const namespaces = await scanNamespaces(config.localesDir, config.sourceLang, fs);

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

	await runWithConcurrency(tasks, concurrency);
}
