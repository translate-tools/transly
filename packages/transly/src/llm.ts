import OpenAI, { ClientOptions } from 'openai';
import z from 'zod';

import type { Config, PromptGenerator, TranslationItem } from './types.js';

function getDefaultSystemPrompt(languageCode: string) {
	const languageName = new Intl.DisplayNames('en', { type: 'language' }).of(
		languageCode,
	);

	return `Translate the contents of the i18n JSON file to ${languageName} according to the BCP 47 standard, ensuring the integrity and structure of the file are preserved. Please adhere to the following guidelines:

- **Keep the keys identical to the original file** to ensure structural integrity. The translation should occur in the values only.
- **Maintain valid i18n JSON file format** throughout the translation process.

Upon completion of the translation:

1. **Verify Key-Value Pairing**: Please conduct a final review to ensure that all keys remain unchanged from the original file and that each key's associated content is accurately translated and correctly placed.

2. **Validate Structure and Syntax**: Confirm that the resulting JSON structure is valid and matches the original schema, paying close attention to brackets, braces, commas, and quotes.

3. **Cross-verify Translations**: If possible, cross-reference your translations with another source or a native speaker to ensure accuracy and naturalness of the language.

The aim is to achieve a fluent and structurally sound translation of the JSON content from the base language to the target language ${languageName}, without altering the document's schema or disrupting the key-value relationship.

Return only translated JSON. Do no add any comments you your response.`;
}

/**
 * Expected shape of the LLM response: a JSON object mapping flat keys to
 * translated string values.
 *
 * Example:
 *   { "greeting": "Hallo", "nested.message": "Welt" }
 */
export type LlmTranslationResponse = Record<string, string>;

/**
 * Sends a batch of translation items to the LLM and returns the translated
 * key→value map.
 *
 * The LLM is instructed (via the system prompt) to return a JSON object where
 * each key maps to its translation in the target language.
 *
 * @param items - Items to translate in this batch
 * @param targetLang - Target language code (e.g. "de")
 * @param config - Validated user config
 * @returns Record mapping each key to its translated string
 * @throws Error on HTTP failure or malformed LLM response
 */
export async function translateChunk(
	items: TranslationItem[],
	targetLang: string,
	config: Config,
	clientConfig?: ClientOptions,
): Promise<LlmTranslationResponse> {
	const client = new OpenAI({
		apiKey: config.apiKey,
		baseURL: config.baseUrl,
		fetch: async (url, init) => {
			const res = await (config.fetch ?? fetch)(url, init);

			const contentType = res.headers.get('content-type') || '';

			if (!contentType.includes('application/json')) {
				const text = await res.text();
				if (config.debug) console.log(text);

				throw new Error(
					`API error: expected JSON but got ${contentType}. ` +
						`Check baseURL. Preview: ${text.slice(0, 200)}`,
				);
			}

			return res;
		},
		...clientConfig,
	});

	const buildPrompt = (source: string | PromptGenerator) => {
		if (typeof source === 'string') return source;
		return source(targetLang);
	};

	const response = await client.chat.completions
		.create({
			model: config.model,
			messages: [
				{
					role: 'system',
					content: config.systemPrompt
						? buildPrompt(config.systemPrompt)
						: getDefaultSystemPrompt(targetLang),
				},
				...(config.contextPrompt
					? [
							{
								role: 'system',
								content:
									'The app context:\n\n' +
									buildPrompt(config.contextPrompt),
							} as const,
						]
					: []),
				{
					role: 'user',
					content: JSON.stringify(
						Object.fromEntries(items.map(({ key, value }) => [key, value])),
					),
				},
			],
		})
		.then((response) => {
			try {
				return z
					.object({
						choices: z
							.object({
								message: z.object({ content: z.string().nullable() }),
							})
							.array()
							.min(1, 'empty choices'),
					})
					.parse(response);
			} catch (error) {
				if (config.debug) console.log(response);

				throw new Error('Unexpected LLM response shape', { cause: error });
			}
		});

	const content = response.choices[0].message.content;
	if (!content) {
		throw new Error(`LLM response is empty`);
	}

	// Parse the content as JSON translation map
	let parsedJson;
	try {
		// The LLM may wrap the JSON in markdown code fences — strip them
		const json = content
			.replace(/^```(?:json)?\s*/i, '')
			.replace(/\s*```$/, '')
			.trim();

		parsedJson = JSON.parse(json);
	} catch (err) {
		throw new Error(
			`LLM returned non-JSON content: ${err instanceof Error ? err.message : String(err)}\nContent: ${content}`,
			{ cause: err },
		);
	}

	// Validate that all expected keys are present and values are strings
	const translations = z.record(z.string()).parse(parsedJson);
	const result: LlmTranslationResponse = {};
	for (const item of items) {
		const value = translations[item.key];
		if (!value) {
			throw new Error(
				`LLM response missing or invalid translation for key "${item.key}". Got: ${JSON.stringify(value)}`,
			);
		}
		result[item.key] = value;
	}

	return result;
}
