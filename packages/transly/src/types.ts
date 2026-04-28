import { LlmTranslationResponse } from './llm';

/**
 * A single entry in the translation cache.
 * `hash` is the SHA-256 of the source string value.
 * `translations` maps target language code → translated string.
 */
export type CacheEntry = {
	hash: string;
	translation: string;
};

/**
 * The full cache file for one namespace.
 * Keys are flat dot-notation source keys (e.g. "nested.message").
 */
export type CacheFile = Record<string, CacheEntry>;

export type PromptGenerator = (targetLanguage: string) => string;

/**
 * Validated user configuration loaded from `i18n.config.js`.
 */
export type Config = {
	/** Source language code, e.g. "en" */
	sourceLang: string;
	/** Target language codes, e.g. ["de", "fr"] */
	targetLangs: string[];
	/** Path to the locales directory, e.g. "./src/locales" */
	localesDir: string;
	/** Directory where cache files are stored, e.g. "./.i18n-cache" */
	cacheDir: string;
	/** LLM model identifier, e.g. "openai/gpt-4o-mini" */
	model: string;
	/** API key for the LLM provider */
	apiKey: string;
	/** Optional base URL for the API (defaults to OpenAI-compatible endpoint) */
	baseUrl?: string;
	/** System prompt instructing the LLM how to translate */
	systemPrompt?: string | PromptGenerator;
	/**
	 * Prompt to explain the app context and the terms to the LLM
	 */
	contextPrompt?: string | PromptGenerator;
	/** Maximum number of keys per LLM request batch */
	maxBatchSize?: number;
	translateChunk?: (
		items: TranslationItem[],
		targetLang: string,
		config: Config,
	) => Promise<LlmTranslationResponse>;
	debug?: boolean;
	fetch?: typeof fetch;
};

/**
 * A single item to be translated: a flat key and its source value.
 */
export type TranslationItem = {
	key: string;
	value: string;
};

/**
 * Filesystem abstraction — compatible with Node's `fs/promises` and `memfs`.
 */
export type FsAdapter = {
	readFile(path: string, encoding: BufferEncoding): Promise<string>;
	writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
	mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
	readdir(path: string): Promise<string[]>;
	access(path: string): Promise<void>;
};
