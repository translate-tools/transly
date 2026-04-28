import { computeHash, readCache, writeCache } from './cache.js';
import { flattenJson } from './flatten.js';
import { scanNamespaces } from './scanner.js';
import type { Config, FsAdapter } from './types.js';
import { makeNodeFsAdapter } from './utils/makeNodeFsAdapter.js';

export async function fillCacheFromTranslations(
	config: Config,
	fs: FsAdapter = makeNodeFsAdapter(),
): Promise<void> {
	// Fetch the namespaces content
	const sourceNamespaceContent: Record<string, Map<string, unknown>> = {};
	const sourceNamespaces = await scanNamespaces(
		config.localesDir,
		config.sourceLang,
		fs,
	);
	for (const { namespace, content } of sourceNamespaces) {
		if (!(namespace in sourceNamespaceContent))
			sourceNamespaceContent[namespace] = new Map();
		Object.entries(flattenJson(content)).forEach(([key, value]) => {
			sourceNamespaceContent[namespace].set(key, value);
		});
	}

	// Add the translations into cache
	for (const language of config.targetLangs) {
		const namespaces = await scanNamespaces(config.localesDir, language, fs);

		for (const { namespace, content } of namespaces) {
			const cache = await readCache(config.cacheDir, namespace, language, fs);
			Object.entries(flattenJson(content)).forEach(([key, translation]) => {
				// Skip keys that does not exist in source locale
				if (
					!sourceNamespaceContent[namespace] ||
					!sourceNamespaceContent[namespace].has(key)
				)
					return;

				const sourceValue = sourceNamespaceContent[namespace].get(key);
				cache[key] = {
					hash: computeHash(String(sourceValue)),
					translation: String(translation),
				};
			});

			// Persist cache immediately after each successful chunk
			await writeCache(config.cacheDir, namespace, language, cache, fs);
		}
	}
}
