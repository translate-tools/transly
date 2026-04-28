import { findUp } from 'find-up';
import { resolve } from 'path';
import { z } from 'zod';

import type { Config, TranslateChunkFn } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asFn = <T extends (...args: any[]) => any>() =>
	z.function() as unknown as z.ZodType<T>;

/**
 * Zod schema for the user-provided i18n config file.
 */
export const configSchema: z.ZodType<Config> = z.object({
	sourceLang: z.string().min(1, 'sourceLang must not be empty'),
	targetLangs: z
		.array(z.string().min(1))
		.min(1, 'targetLangs must have at least one entry'),
	localesDir: z.string().min(1, 'localesDir must not be empty'),

	cacheDir: z.string().min(1, 'cacheDir must not be empty').optional(),
	concurrency: z.number().int().positive().optional(),
	maxBatchSize: z.number().int().positive().optional(),

	translateChunk: asFn<TranslateChunkFn>().optional(),
	llm: z
		.object({
			model: z.string().min(1, 'model must not be empty'),
			apiKey: z.string().min(1, 'apiKey must not be empty').optional(),
			baseUrl: z.string().url().optional(),
			systemPrompt: z
				.function(z.tuple([z.string()]), z.string())
				.or(z.string().min(1, 'system prompt must not be empty'))
				.optional(),
			contextPrompt: z
				.function(z.tuple([z.string()]), z.string())
				.or(z.string().min(1, 'prompt must not be empty'))
				.optional(),
		})
		.optional(),
	fetch: z.any().optional(),
	debug: z.coerce.boolean().optional(),
});

/**
 * Dynamically imports an ESM config file and validates it with Zod.
 *
 * @param configPath - Absolute or relative path to the config file (e.g. "./i18n.config.js")
 * @returns Validated Config object
 * @throws ZodError if the config is invalid, or Error if the file cannot be loaded
 */
export async function loadConfigFile(configPath: string): Promise<Config> {
	let raw: unknown;

	try {
		const module = (await import(configPath)) as { default?: unknown };
		// Support both `export default` and `module.exports =`
		raw = module.default ?? module;
	} catch (err) {
		throw new Error(
			`Failed to load config from "${configPath}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const result = configSchema.safeParse(raw);

	if (!result.success) {
		const messages = result.error.errors
			.map((e) => `  - ${e.path.join('.')}: ${e.message}`)
			.join('\n');
		throw new Error(`Invalid config:\n${messages}`);
	}

	return result.data;
}

export async function loadConfig(path?: string) {
	const configPath = path
		? resolve(path)
		: await findUp(
				['mts', 'cts', 'ts', 'mjs', 'cjs', 'js'].map(
					(ext) => `transly.config.${ext}`,
				),
			);

	if (!configPath) throw new Error('Config file is not found');

	let config;
	try {
		config = await loadConfigFile(configPath);
	} catch (err) {
		console.error(
			`\n❌ Config error: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}

	return { config, configPath };
}
