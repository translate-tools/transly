#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'path';
import { z } from 'zod';

import { description, name, version } from '../package.json';
import { getCacheDir } from './cache';
import { fillCacheFromTranslations } from './cacheUtils';
import { DEFAULT_CONCURRENCY } from './concurrency.js';
import { loadConfig } from './config.js';
import { translateChunk } from './llm';
import { ProgressRenderer } from './progressRenderer.js';
import { runTranslation } from './runner.js';
import { makeNodeFsAdapter } from './utils/makeNodeFsAdapter';

const program = new Command().name(name).description(description).version(version);

const hydrateOptionsSchema = z.object({
	config: z.string().default('./transly.config.js'),
});

const translateOptionsSchema = z.object({
	config: z.string().default('./transly.config.js'),
	concurrency: z.coerce.number().int().positive().optional(),
});

const cache = program.command('cache').description('Cache operations');

cache
	.command('hydrate')
	.alias('restore')
	.alias('seed')
	.description('Fill cache from existing translations')
	.option('-c, --config <path>', 'Path to the i18n config file')
	.action(async (rawOptions: unknown) => {
		const options = hydrateOptionsSchema.parse(rawOptions);
		const configPath = resolve(options.config);

		console.log(`Loading config from: ${configPath}`);

		let config;
		try {
			config = await loadConfig(configPath);
		} catch (err) {
			console.error(
				`\n❌ Config error: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}

		console.log('Hydrating cache...');
		await fillCacheFromTranslations(config, makeNodeFsAdapter());
	});

program
	.command('translate')
	.option('-c, --config <path>', 'Path to the i18n config file')
	.option(
		'-j, --concurrency <n>',
		`Number of parallel translation tasks (default: ${DEFAULT_CONCURRENCY})`,
	)
	.action(async (rawOptions: unknown) => {
		const options = translateOptionsSchema.parse(rawOptions);
		const configPath = resolve(options.config);

		console.log(`Loading config from: ${configPath}`);

		let config;
		try {
			config = await loadConfig(configPath);
		} catch (err) {
			console.error(
				`\n❌ Config error: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}

		if (options.concurrency !== undefined) {
			config = { ...config, concurrency: options.concurrency };
		}

		const effectiveConcurrency = config.concurrency ?? DEFAULT_CONCURRENCY;

		console.log(`Source language:  ${config.sourceLang}`);
		console.log(`Target languages: ${config.targetLangs.join(', ')}`);
		console.log(`Locales dir:      ${config.localesDir}`);
		console.log(`Cache dir:        ${getCacheDir(config)}`);
		console.log(`Concurrency:      ${effectiveConcurrency} workers`);
		if (config.llm) {
			console.log(`Model:            ${config.llm.model}`);
		}
		console.log('');

		const renderer = new ProgressRenderer({ isTTY: process.stdout.isTTY ?? false });

		try {
			await runTranslation(
				config,
				makeNodeFsAdapter(),
				config.translateChunk ?? translateChunk,
				(event) => {
					renderer.onEvent(event);
				},
			);
			renderer.printSummary();
		} catch (err) {
			console.error(
				`\n❌ Translation failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}
	});

program.parse(process.argv);
