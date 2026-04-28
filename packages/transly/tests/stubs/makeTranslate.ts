import { vi } from 'vitest';

import type { TranslationItem } from '../../src/types.js';

export type TranslateCallLog = { items: TranslationItem[]; targetLang: string };

/**
 * Creates a deterministic mock translate function.
 * Each translated value is prefixed with the target language code: `[lang] value`.
 *
 * Pass a `callLog` array to record every invocation for later assertions.
 */
export function makeMockTranslate(callLog: TranslateCallLog[] = []) {
	return vi.fn(async (items: TranslationItem[], targetLang: string) => {
		callLog.push({ items: [...items], targetLang });

		const result: Record<string, string> = {};
		for (const item of items) {
			result[item.key] = `[${targetLang}] ${item.value}`;
		}
		return result;
	});
}
