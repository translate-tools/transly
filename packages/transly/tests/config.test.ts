import { describe, expect, it } from 'vitest';

import { configSchema } from '../src/config.js';

const validConfig = {
	sourceLang: 'en',
	targetLangs: ['de', 'fr'],
	localesDir: './src/locales',
	cacheDir: './.i18n-cache',
	model: 'openai/gpt-4o-mini',
	apiKey: 'sk-test-key',
	baseUrl: 'https://openrouter.ai/api/v1',
	prompt: 'Translate the following strings.',
	maxBatchSize: 50,
};

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

	it('accepts a config without optional fields', () => {
		const minimal = {
			sourceLang: 'en',
			targetLangs: ['de'],
			localesDir: './locales',
			cacheDir: './.cache',
			model: 'gpt-4',
			apiKey: 'key',
			prompt: 'Translate.',
		};
		const result = configSchema.safeParse(minimal);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.baseUrl).toBeUndefined();
			expect(result.data.maxBatchSize).toBeUndefined();
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
		const result = configSchema.safeParse({ ...validConfig, apiKey: '' });
		expect(result.success).toBe(false);
	});

	it('rejects config with invalid baseUrl', () => {
		const result = configSchema.safeParse({ ...validConfig, baseUrl: 'not-a-url' });
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
