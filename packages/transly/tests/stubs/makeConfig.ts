import type { Config } from '../../src/types';

/**
 * Creates a minimal valid Config with sensible test defaults.
 * Pass overrides to customize individual fields.
 */
export function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		sourceLang: 'en',
		targetLangs: ['de'],
		localesDir: '/locales',
		cacheDir: '/cache',
		llm: {
			model: 'test-model',
			apiKey: 'test-key',
		},
		maxBatchSize: 10,
		...overrides,
	};
}
