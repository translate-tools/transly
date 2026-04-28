#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from 'src/config';
import { z } from 'zod';

import { fillCacheFromTranslations } from '../cacheUtils';
import { makeNodeFsAdapter } from '../utils/makeNodeFsAdapter';

const hydrateOptionsSchema = z.object({
	config: z.string().default('./transly.config'),
});

export default function (program: Command) {
	const cache = program.command('cache').description('Cache operations');

	cache
		.command('hydrate')
		.alias('restore')
		.alias('seed')
		.description('Fill cache from existing translations')
		.option('-c, --config <path>', 'Path to config file')
		.action(async (rawOptions: unknown) => {
			const options = hydrateOptionsSchema.parse(rawOptions);
			const { config } = await loadConfig(options.config);

			console.log('Hydrating cache...');
			await fillCacheFromTranslations(config, makeNodeFsAdapter());
		});

	return cache;
}
