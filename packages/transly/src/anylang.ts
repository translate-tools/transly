import { TranslatorInstanceMembers } from 'anylang/translators';

import { TranslateChunkFn } from './types';

export const anylangTranslator = (
	translator: TranslatorInstanceMembers,
): TranslateChunkFn => {
	return async (items, language, config) => {
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
