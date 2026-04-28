import type { TranslationItem } from './types.js';

/** Default maximum number of items per LLM request batch */
export const DEFAULT_MAX_BATCH_SIZE = 50;

/**
 * Splits an array of translation items into chunks of at most `maxBatchSize`.
 *
 * This ensures large datasets are processed safely without hitting LLM
 * context limits or rate limits.
 *
 * @param items - Flat list of items to translate
 * @param maxBatchSize - Maximum items per chunk (defaults to DEFAULT_MAX_BATCH_SIZE)
 * @returns Array of chunks; empty array if `items` is empty
 */
export function chunkItems(
	items: TranslationItem[],
	maxBatchSize: number = DEFAULT_MAX_BATCH_SIZE,
): TranslationItem[][] {
	if (items.length === 0) return [];
	if (maxBatchSize <= 0) throw new Error('maxBatchSize must be a positive integer');

	const chunks: TranslationItem[][] = [];

	for (let i = 0; i < items.length; i += maxBatchSize) {
		chunks.push(items.slice(i, i + maxBatchSize));
	}

	return chunks;
}
