import 'dotenv/config';

import { defineConfig } from '../../src';

export const waitRandom = async (minMs = 50, maxMs = 3000) => {
	const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
	return new Promise((resolve) => setTimeout(resolve, delay));
};

export default defineConfig({
	debug: true,

	sourceLang: 'en',
	targetLangs: ['cs', 'da', 'de', 'es', 'fr', 'hu', 'it', 'ja'],
	localesDir: './locales',

	maxBatchSize: 5,
	async translateChunk(items, language) {
		await waitRandom();
		return Object.fromEntries(
			items.map((item) => [item.key, `[${language}] ${item.value}`]),
		);
	},
});
