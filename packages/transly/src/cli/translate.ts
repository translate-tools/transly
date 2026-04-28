#!/usr/bin/env node
import { MicrosoftTranslator } from 'anylang/translators';
import { Command } from 'commander';
import { anylangAdapter } from 'src/anylang';
import { loadConfig } from 'src/config';
import { z } from 'zod';

import { getCacheDir } from '../cache';
import { DEFAULT_CONCURRENCY } from '../concurrency';
import { translateChunk } from '../llm';
import { ProgressRenderer } from '../progressRenderer';
import { runTranslation } from '../runner';
import { makeNodeFsAdapter } from '../utils/makeNodeFsAdapter';

export const labelLanguageCode = (languageCode: string) => {
	const languageName = new Intl.DisplayNames('en', { type: 'language' }).of(
		languageCode,
	);
	const nameHasNotFound = languageName === languageCode;
	return nameHasNotFound ? languageCode : `${languageName} (${languageCode})`;
};

const translateOptionsSchema = z.object({
	config: z.string().default('./transly.config'),
	concurrency: z.coerce.number().int().positive().optional(),
});

export default function (program: Command) {
	const translate = program.command('translate');

	translate
		.option('-c, --config <path>', 'Path to config file')
		.option(
			'-j, --concurrency <n>',
			`Number of parallel translation tasks (default: ${DEFAULT_CONCURRENCY})`,
		)
		.action(async (rawOptions: unknown) => {
			const options = translateOptionsSchema.parse(rawOptions);
			const { config } = await loadConfig(options.config);

			if (options.concurrency !== undefined) {
				config.concurrency = options.concurrency;
			}

			const effectiveConcurrency = config.concurrency ?? DEFAULT_CONCURRENCY;

			console.log(`Source language:  ${labelLanguageCode(config.sourceLang)}`);
			console.log(
				`Target languages: ${config.targetLangs.map(labelLanguageCode).join(', ')}`,
			);
			console.log(`Locales dir:      ${config.localesDir}`);
			console.log(`Cache dir:        ${getCacheDir(config)}`);
			console.log(`Concurrency:      ${effectiveConcurrency} workers`);
			if (config.llm) {
				console.log(`Model:            ${config.llm.model}`);
			}
			console.log('');

			const renderer = new ProgressRenderer({
				isTTY: process.stdout.isTTY ?? false,
			});

			let translator = config.translateChunk;
			if (!translator) {
				if (config.llm) translator = translateChunk;
				else translator = anylangAdapter(new MicrosoftTranslator());
			}

			try {
				await runTranslation(config, makeNodeFsAdapter(), translator, (event) => {
					renderer.onEvent(event);
				});
				renderer.printSummary();
			} catch (err) {
				console.error(
					`\n❌ Translation failed: ${err instanceof Error ? err.message : String(err)}`,
				);
				process.exit(1);
			}
		});

	return translate;
}
