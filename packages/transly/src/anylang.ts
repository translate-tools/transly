import { TranslatorInstanceMembers } from 'anylang/translators';

import { TranslateChunkFn } from './types';

export const anylangAdapter = (
	translator: TranslatorInstanceMembers,
	supportedLanguages?: string[],
): TranslateChunkFn => {
	return async (items, language, config) => {
		// Try to fix unsupported languages
		if (supportedLanguages && !supportedLanguages.includes(language)) {
			// Try to use language group
			const languageGroup = language.split('-')[0];
			if (supportedLanguages.includes(languageGroup)) {
				language = languageGroup;
			}
		}

		const translations = await translator.translateBatch(
			items.map((item) => item.value),
			config.sourceLang,
			language,
		);

		return Object.fromEntries(
			items.map((item, index) => {
				const translation = translations[index];
				if (translation === null || translation === undefined)
					throw new Error(`Translation for key ${item.key} is not found`);

				return [item.key, translation];
			}),
		);
	};
};
