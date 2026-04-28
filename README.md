# transly

Cache-driven i18n translation CLI. Translates your JSON locale files incrementally — only strings that actually changed since the last run are sent for translation. The translator is fully configurable: use any LLM, any free translation service, or implement your own.

## What it does

On each run transly scans your source locale directory, computes a SHA-256 hash of every string, compares it against a local cache, and translates only the keys that are new or changed. Translated strings are written to the target language directories and the cache is updated. If a batch fails mid-run, everything translated so far is already saved — just re-run to continue.

## Why transly

- Only translates what changed, based on content hashes — not git history, not timestamps
- Cache is written after every chunk, so partial failures never lose work
- Translator backend is pluggable: LLM, free API, or your own function
- Works without any LLM config at all (falls back to a free translation service)
- Concurrent translation of multiple namespace × language pairs

## Quick start

Install:

```bash
npm install -D transly
```

Create `transly.config.ts` in your project root:

```ts
import 'dotenv/config';
import { defineConfig } from 'transly';

export default defineConfig({
  sourceLang: 'en',
  targetLangs: ['de', 'fr', 'ja'],
  localesDir: './src/locales',

  llm: {
    model: 'openai/gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    contextPrompt: 'This is a web application for managing personal finances.',
  },
});
```

Put your source strings in `src/locales/en/`:

`src/locales/en/example.json`

```json
{
  "title": "Dashboard",
  "greeting": "Hello, {{name}}!"
}
```

Run:

```bash
npx transly translate
```

Transly writes the translated files to `src/locales/de/`, `src/locales/fr/`, etc., and keeps a cache under `src/locales/.transly/` by default.

If you already have translated files from a previous setup, seed the cache before running so transly does not re-translate everything:

```bash
npx transly cache hydrate
npx transly translate
```

> Add `OPENAI_API_KEY=sk-...` to a `.env` file and use `import 'dotenv/config'` at the top of your config. Never hardcode secrets.

## Free translation (no LLM)

If you omit the `llm` block entirely, transly falls back to Microsoft Translator via the [`anylang`](https://www.npmjs.com/package/anylang) package — no API key required. This is convenient for quick tests or non-critical projects, but the translation quality is noticeably lower than what a well-prompted LLM produces.

```ts
import { defineConfig } from 'transly';

export default defineConfig({
  sourceLang: 'en',
  targetLangs: ['de', 'fr', 'ja'],
  localesDir: './src/locales',
});
```

## Cache management

The cache lives at `<localesDir>/.transly/` by default. You can override this with the `cacheDir` config option.

**Strategy 1 — commit the cache.** The cache directory is the source of truth for what has been translated. Committing it means CI and teammates never pay to re-translate strings that are already done.

**Strategy 2 — gitignore the cache, seed on demand.** Add `.transly/` to `.gitignore`. On a fresh clone, seed the cache from the existing translated files before running translation:

```bash
npx transly cache hydrate
npx transly translate
```

This keeps the repository clean at the cost of an extra step per fresh clone.

**Dropping the cache.** To force a full re-translation:

```bash
npx transly cache drop
```

## Config reference

```ts
import { defineConfig } from 'transly';

export default defineConfig({
  // Required
  sourceLang: 'en',
  targetLangs: ['de', 'fr'],
  localesDir: './src/locales',

  // Optional
  cacheDir: './.transly',       // default: <localesDir>/.transly
  maxBatchSize: 50,              // keys per translation request, default: 50
  concurrency: 10,               // parallel tasks, default: 10
  debug: false,

  // LLM translator (optional — omit to use the free fallback)
  llm: {
    model: 'openai/gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1', // any OpenAI-compatible endpoint
    systemPrompt: '...',   // string or (targetLang: string) => string
    contextPrompt: '...',  // string or (targetLang: string) => string
  },

  // Custom translator function (overrides llm and the free fallback)
  translateChunk: async (items, targetLang, config) => {
    // items: Array<{ key: string; value: string }>
    // return: Record<string, string>  (key → translated value)
  },
});
```

Config files are validated with [Zod](https://zod.dev) at startup. Invalid configs exit with code 1 and list every failing field.

## CLI reference

```
transly translate [-c <path>] [-j <n>]
```

Translates all namespaces into all target languages.

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to config file (default: auto-discover `transly.config.ts` / `.js`) |
| `-j, --concurrency <n>` | Number of parallel translation tasks |

```
transly cache hydrate [-c <path>]
transly cache restore [-c <path>]   # alias
transly cache seed    [-c <path>]   # alias
```

Populates the cache from existing translated files without modifying them. Use this when migrating from another tool or after a cache drop.

```
transly cache drop [-c <path>]
```

Deletes the cache directory.

**Exit codes:** `0` — success. `1` — config error or translation failure.

## Custom translators

The `translateChunk` option lets you plug in any translation backend. It receives a batch of `{ key, value }` pairs and must return a `Record<string, string>` mapping each key to its translation.

A minimal example:

```ts
import { defineConfig } from 'transly';

export default defineConfig({
  sourceLang: 'en',
  targetLangs: ['de', 'fr'],
  localesDir: './src/locales',

  async translateChunk(items, targetLang) {
    // call your translation API here
    return Object.fromEntries(
      items.map((item) => [item.key, myTranslate(item.value, targetLang)]),
    );
  },
});
```

To use any of the services supported by the [`anylang`](https://www.npmjs.com/package/anylang) package (Google Translate, DeepL, Yandex, etc.), use the `anylangAdapter` helper:

```ts
import { GoogleTranslator } from 'anylang/translators';
import { defineConfig, anylangAdapter } from 'transly';

export default defineConfig({
  sourceLang: 'en',
  targetLangs: ['de', 'fr'],
  localesDir: './src/locales',
  translateChunk: anylangAdapter(new GoogleTranslator()),
});
```

See the `packages/transly/examples/` directory for more usage patterns.

## Programmatic API

```ts
import { runTranslation, type ProgressEvent } from 'transly/runner';
import { defineConfig, anylangAdapter } from 'transly';
```

**`runTranslation(config, fs?, translateFn?, onProgress?)`** — the main pipeline. Processes all namespace × language pairs respecting concurrency settings.

```ts
await runTranslation(config, undefined, undefined, (event: ProgressEvent) => {
  if (event.type === 'task_start') {
    console.log(`${event.namespace} → ${event.targetLang}: ${event.changedKeys} keys to translate`);
  }
});
```

**Progress event types:**

```ts
type ProgressEvent =
  | { type: 'scan_complete'; namespaces: number; targetLangs: number; totalTasks: number; totalKeys: number }
  | { type: 'task_start';    namespace: string; targetLang: string; totalKeys: number; changedKeys: number }
  | { type: 'chunk_done';    namespace: string; targetLang: string; chunkIndex: number; totalChunks: number; chunkSize: number }
  | { type: 'task_done';     namespace: string; targetLang: string }
  | { type: 'task_skip';     namespace: string; targetLang: string };
```

**`defineConfig(config)`** — identity helper that provides TypeScript types when writing `.ts` config files.

**`anylangAdapter(translator)`** — wraps any `anylang`-compatible translator instance into a `translateChunk` function.

## Comparison

| Feature | transly | i18next-scanner | @lingui/cli | @formatjs/cli | i18n-auto-translation |
|---|---|---|---|---|---|
| Incremental (hash-based) | ✅ | ❌ | ❌ | ❌ | ❌ |
| LLM support | ✅ | ❌ | ❌ | ❌ | ✅ |
| Custom translator | ✅ | ❌ | ❌ | ❌ | ❌ |
| Free translation fallback | ✅ | ❌ | ❌ | ❌ | ✅ |
| Partial-failure safety | ✅ | n/a | n/a | n/a | ❌ |
| Extracts keys from source code | ❌ | ✅ | ✅ | ✅ | ❌ |
| Format support | JSON | many | many | many | JSON |

transly is not a key extractor — it translates existing JSON locale files. Pair it with i18next-scanner or a similar tool if you also need to extract keys from source code.

### ❤️ Support & Contribute

This project is open-source under the Apache 2.0 License — it not only allows you to use and modify the code freely, but also protects contributors by explicitly granting patent rights and requiring proper attribution.

Contributions are very welcome — whether it’s code, ideas, bug reports, or improvements.

If you find this tool useful:

* ⭐ Star the repository
* 📢 Share it with others
* 💡 Help shape it with your feedback

*Good tools get better when people care.*

Want to help?

* Fix something
* Suggest something
* Break something (and report it)

And if you like it, a ⭐ on GitHub goes a long way.
