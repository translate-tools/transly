# transly

**Cache-driven LLM i18n translation CLI.**

Translates your i18n JSON locale files using any OpenAI-compatible LLM (OpenRouter, OpenAI, Ollama, etc.), with **incremental updates based on content hashing** — so you only ever pay for strings that actually changed.

---

## Why transly?

Most translation tools re-translate everything on every run, or rely on git history to detect changes. Both approaches have real problems at scale.

| Problem | Common tools | transly |
|---|---|---|
| Re-translates unchanged strings | ✅ wastes money & time | ❌ never |
| Requires git history | often yes | ❌ never |
| Survives partial LLM failures | rarely | ✅ always |
| Works with large files | context limit issues | ✅ chunked batches |
| Prompt fully under your control | limited | ✅ fully |
| Works with any OpenAI-compatible API | often locked to OpenAI | ✅ any provider |

### How change detection works

transly computes a **SHA-256 hash of each source string value** and stores it in a local cache file alongside the translation. On the next run it compares hashes:

- Hash unchanged → skip, use cached translation
- Hash changed or key is new → send to LLM

No git. No timestamps. No full-file diffing. Just content.

### Partial failure safety

LLM APIs fail. Rate limits happen. transly writes the cache **after every successful chunk**, not at the end of the run. If chunk 3 of 5 fails, chunks 1 and 2 are already saved. Re-run and it picks up exactly where it left off — no duplicate API calls, no data loss.

---

## Installation

```bash
npm install -D transly
# or globally
npm install -g transly
```

Requires **Node.js ≥ 22**.

---

## Quick start

### 1. Create a config file

Create `transly.config.js` in your project root:

```js
// transly.config.js
export default {
  sourceLang: 'en',
  targetLangs: ['de', 'fr', 'ja'],

  localesDir: './src/locales',
  cacheDir: './.transly-cache',

  model: 'openai/gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: 'https://openrouter.ai/api/v1', // optional, defaults to OpenRouter
  systemPrompt: `You are a professional UI translator.
Return a JSON object mapping each key to its translation in the target language.
Preserve placeholders like {{name}} and {{count}} exactly.
Keep translations concise and natural.`,
  contextPrompt: `The vault is an encrypted directory where app keeps the user files. Not a bank safe.`,

  maxBatchSize: 50, // optional, default: 50
};
```

### 2. Organize your locale files

```
src/locales/
  en/
    common.json
    features.json
```

Each file contains nested JSON:

```json
{
  "title": "Hello",
  "nested": {
    "message": "Welcome, {{name}}!"
  }
}
```

### 3. Run

```bash
npx transly translate
```

Or with a custom config path:

```bash
npx transly translate --config ./config/transly.config.js
```

### 4. Output

transly writes translated files alongside your source:

```
src/locales/
  en/
    common.json       ← source (unchanged)
  de/
    common.json       ← generated
  fr/
    common.json       ← generated
  ja/
    common.json       ← generated
```

And stores the cache:

```
.transly-cache/
  common.de.json
  common.fr.json
  common.ja.json
```

> **Tip:** Commit the cache directory to version control. This ensures teammates and CI never re-translate strings that are already done.

## Initialize Cache from Existing Translations

If you already have translated locale files (from another tool or a previous setup), you can bootstrap Transly’s cache without re-translating everything.

Use:

```bash
transly cache seed
```

### What it does

* Scans your existing locale files
* Extracts translations
* Populates the internal cache
* Enables incremental translation (only new/changed messages will be processed)

### When to use

* Migrating from another i18n tool
* Cache directory was removed or corrupted
* First-time setup with pre-existing translations

### Typical flow

```bash
# 1. Seed cache from current translations
transly cache seed

# 2. Run translation (only missing/changed keys will be processed)
transly translate
```

### Notes

* This command does **not** modify your locale files
* Safe to run multiple times
* Existing cache entries may be updated if translations changed

After seeding, Transly will treat your current translations as the baseline and only process diffs going forward.

---

## Config reference

```ts
type Config = {
  /** Source language code. Must match a directory name under localesDir. */
  sourceLang: string;

  /** List of target language codes to translate into. */
  targetLangs: string[];

  /** Path to the root locales directory. */
  localesDir: string;

  /** Directory where cache files are stored. Created automatically. */
  cacheDir: string;

  /** LLM model identifier (e.g. "openai/gpt-4o-mini", "anthropic/claude-3-haiku"). */
  model: string;

  /** API key for the LLM provider. */
  apiKey: string;

  /**
   * Base URL of the OpenAI-compatible API.
   * Defaults to https://openrouter.ai/api/v1
   */
  baseUrl?: string;

  /**
   * System prompt sent to the LLM before each batch.
   * You have full control. The user message will contain:
   *   { targetLang: "de", items: [{ key: "title", value: "Hello" }, ...] }
   * The LLM must respond with a JSON object: { "title": "Hallo", ... }
   */
  prompt: string;

  /**
   * Maximum number of keys per LLM request.
   * Larger values = fewer API calls but higher risk of hitting context limits.
   * Default: 50
   */
  maxBatchSize?: number;
};
```

### Validation

The config is validated with [Zod](https://zod.dev) at startup. Invalid configs produce a clear error message listing every field that failed, then exit with code 1.

---

## CLI reference

```
Usage: transly [options]

Cache-driven LLM i18n translation CLI

Options:
  -V, --version          output the version number
  -c, --config <path>    Path to the i18n config file (default: "./transly.config.js")
  -h, --help             display help for command
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | All translations completed successfully |
| `1` | Config error or translation failure |

---

## LLM request format

Each batch is sent as a standard chat completion request:

```json
{
  "model": "openai/gpt-4o-mini",
  "messages": [
    {
      "role": "system",
      "content": "<your prompt>"
    },
    {
      "role": "user",
      "content": "{\"targetLang\":\"de\",\"items\":[{\"key\":\"title\",\"value\":\"Hello\"}]}"
    }
  ]
}
```

The LLM must respond with a JSON object mapping each key to its translation:

```json
{
  "title": "Hallo"
}
```

transly automatically strips markdown code fences (` ```json ... ``` `) from the response if the model wraps its output in them.

---

## Cache format

One cache file per namespace × target language, stored as JSON:

```
.transly-cache/
  features.de.json
  features.fr.json
  common.de.json
```

Each file maps flat dot-notation keys to their hash and translations:

```json
{
  "title": {
    "hash": "185f8db32921bd46d35cc2e877d9e8...",
    "translations": {
      "de": "Hallo",
      "fr": "Bonjour"
    }
  },
  "nested.message": {
    "hash": "a94a8fe5ccb19ba61c4c0873d391e...",
    "translations": {
      "de": "Willkommen, {{name}}!",
      "fr": "Bienvenue, {{name}} !"
    }
  }
}
```

- `hash` — SHA-256 of the source string. If this changes, the key is retranslated.
- `translations` — one entry per target language. A key is retranslated for a language if its entry is missing.

---

## Programmatic API

transly exposes its internals as TypeScript modules for use in custom scripts or build tools.

### `runTranslation(config, fs?, translateFn?, onProgress?)`

The main pipeline. Processes all namespaces and target languages.

```ts
import { runTranslation } from 'transly/runner';
import type { ProgressEvent } from 'transly/runner';

await runTranslation(config, undefined, undefined, (event: ProgressEvent) => {
  if (event.type === 'namespace_start' && event.changedKeys > 0) {
    console.log(`Translating ${event.changedKeys} keys in ${event.namespace} → ${event.targetLang}`);
  }
});
```

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config` | `Config` | required | Validated config object |
| `fs` | `FsAdapter` | Node `fs/promises` | Filesystem adapter (injectable for testing) |
| `translateFn` | `typeof translateChunk` | real LLM call | Translation function (injectable for testing) |
| `onProgress` | `ProgressCallback` | `undefined` | Progress event handler |

**Progress events:**

```ts
type ProgressEvent =
  | { type: 'namespace_start'; namespace: string; targetLang: string; totalKeys: number; changedKeys: number }
  | { type: 'chunk_done';      namespace: string; targetLang: string; chunkIndex: number; totalChunks: number }
  | { type: 'namespace_done'; namespace: string; targetLang: string }
  | { type: 'no_changes';     namespace: string; targetLang: string };
```

---

### `loadConfig(configPath)`

Dynamically imports an ESM config file and validates it with Zod.

```ts
import { loadConfig } from 'transly/config';

const config = await loadConfig('./transly.config.js');
```

Throws a descriptive `Error` if the file cannot be loaded or the config is invalid.

---

### `flattenJson(obj)` / `unflattenJson(flat)`

Convert between nested JSON and flat dot-notation maps.

```ts
import { flattenJson, unflattenJson } from 'transly/flatten';

flattenJson({ nested: { message: 'World' } });
// → { 'nested.message': 'World' }

unflattenJson({ 'nested.message': 'World' });
// → { nested: { message: 'World' } }
```

---

### `computeHash(value)`

SHA-256 hash of a string. Used for cache change detection.

```ts
import { computeHash } from 'transly/cache';

computeHash('Hello'); // → '185f8db32921bd46d35cc2e877d9e8...'
```

---

### `chunkItems(items, maxBatchSize?)`

Splits a flat list of translation items into batches.

```ts
import { chunkItems } from 'transly/chunker';

const chunks = chunkItems(items, 25);
// → TranslationItem[][]
```

---

### `translateChunk(items, targetLang, config)`

Sends one batch to the LLM and returns the translated key→value map.

```ts
import { translateChunk } from 'transly/llm';

const translations = await translateChunk(
  [{ key: 'title', value: 'Hello' }],
  'de',
  config,
);
// → { title: 'Hallo' }
```

Throws on HTTP error, network failure, or malformed LLM response.

---

### `FsAdapter` interface

All file I/O goes through this interface, making the entire pipeline testable without touching the real filesystem.

```ts
type FsAdapter = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
  readdir(path: string): Promise<string[]>;
  access(path: string): Promise<void>;
};
```

Compatible with Node's `fs/promises` and [`memfs`](https://github.com/streamich/memfs).

---

## Supported LLM providers

Any provider that exposes an OpenAI-compatible `/chat/completions` endpoint works:

| Provider | `baseUrl` |
|---|---|
| [OpenRouter](https://openrouter.ai) | `https://openrouter.ai/api/v1` (default) |
| OpenAI | `https://api.openai.com/v1` |
| Anthropic (via OpenRouter) | use OpenRouter |
| Ollama (local) | `http://localhost:11434/v1` |
| Any other | set `baseUrl` accordingly |

---

## Tips

**Commit the cache.** The cache is the source of truth for what has been translated. Committing it means CI and teammates never re-translate already-done strings.

**Tune `maxBatchSize` for your model.** Smaller models have smaller context windows. If you see truncated responses, reduce `maxBatchSize` to 20–30.

**Write a precise prompt.** The quality of translations depends entirely on your prompt. Include glossary terms, tone guidelines, and placeholder preservation rules. See `packages/app/transmart.config.js` in this repo for a real-world example.

**Use environment variables for the API key.** Never hardcode secrets in the config file.

```js
export default {
  apiKey: process.env.OPENAI_API_KEY ?? (() => { throw new Error('OPENAI_API_KEY is not set'); })(),
  // ...
};
```
