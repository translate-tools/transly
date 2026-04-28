import 'dotenv/config';

import { MicrosoftTranslator } from 'anylang/translators';

import { defineConfig } from '../../src';

const translator = new MicrosoftTranslator();

export default defineConfig({
	debug: true,

	sourceLang: 'en',
	targetLangs: ['cs', 'da', 'de', 'es', 'fr', 'hu', 'it', 'ja'],
	localesDir: './locales',

	maxBatchSize: 5,
	async translateChunk(items, language, config) {
		const translations = await translator.translateBatch(
			items.map((item) => item.value),
			config.sourceLang,
			language,
		);

		return Object.fromEntries(
			items.map((item, index) => [item.key, translations[index]]),
		);
	},
});
