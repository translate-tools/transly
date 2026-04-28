import { Config } from 'src/types.js';
import { describe, expect, it } from 'vitest';

import { configSchema } from '../src/config.js';

const validConfig = {
	sourceLang: 'en',
	targetLangs: ['de', 'fr'],
	localesDir: './src/locales',
	cacheDir: './.i18n-cache',

	llm: {
		model: 'openai/gpt-4o-mini',
		apiKey: 'sk-test-key',
		baseUrl: 'https://openrouter.ai/api/v1',
		systemPrompt: 'Translate the following strings.',
	},
	maxBatchSize: 50,
} satisfies Config;

describe('Config schema validation', () => {
	it('accepts a fully valid config', () => {
		const result = configSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sourceLang).toBe('en');
			expect(result.data.targetLangs).toEqual(['de', 'fr']);
			expect(result.data.maxBatchSize).toBe(50);
		}
	});

	it('rejects config with missing required fields', () => {
		const result = configSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	it('rejects config with empty sourceLang', () => {
		const result = configSchema.safeParse({ ...validConfig, sourceLang: '' });
		expect(result.success).toBe(false);
	});

	it('rejects config with empty targetLangs array', () => {
		const result = configSchema.safeParse({ ...validConfig, targetLangs: [] });
		expect(result.success).toBe(false);
	});

	it('rejects config with empty string in targetLangs', () => {
		const result = configSchema.safeParse({
			...validConfig,
			targetLangs: ['de', ''],
		});
		expect(result.success).toBe(false);
	});

	it('rejects config with wrong type for targetLangs', () => {
		const result = configSchema.safeParse({ ...validConfig, targetLangs: 'de' });
		expect(result.success).toBe(false);
	});

	it('rejects config with empty apiKey', () => {
		const result = configSchema.safeParse({
			...validConfig,
			llm: { ...validConfig.llm, apiKey: '' },
		});
		expect(result.success).toBe(false);
	});

	it('rejects config with invalid baseUrl', () => {
		const result = configSchema.safeParse({
			...validConfig,
			llm: { ...validConfig.llm, baseUrl: '' },
		});
		expect(result.success).toBe(false);
	});

	it('rejects config with non-positive maxBatchSize', () => {
		const result = configSchema.safeParse({ ...validConfig, maxBatchSize: 0 });
		expect(result.success).toBe(false);
	});

	it('rejects config with negative maxBatchSize', () => {
		const result = configSchema.safeParse({ ...validConfig, maxBatchSize: -5 });
		expect(result.success).toBe(false);
	});

	it('rejects config with non-integer maxBatchSize', () => {
		const result = configSchema.safeParse({ ...validConfig, maxBatchSize: 1.5 });
		expect(result.success).toBe(false);
	});

	it('collects multiple validation errors', () => {
		const result = configSchema.safeParse({
			sourceLang: '',
			targetLangs: [],
			model: '',
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.errors.length).toBeGreaterThan(1);
		}
	});
});
