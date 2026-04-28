import { defineConfig } from '../../src';

export default defineConfig({
	sourceLang: 'en',
	targetLangs: ['cs', 'da', 'de', 'es', 'fr', 'hu', 'it', 'ja', 'ru'],
	localesDir: './locales',
	maxBatchSize: 50,
	debug: true,
});
