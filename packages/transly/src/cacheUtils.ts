import { computeHash, getCacheDir, readCache, writeCache } from './cache';
import { flattenJson } from './flatten';
import { scanNamespaces } from './scanner';
import type { Config, FsAdapter } from './types';
import { makeNodeFsAdapter } from './utils/makeNodeFsAdapter';

export async function fillCacheFromTranslations(
	config: Config,
	fs: FsAdapter = makeNodeFsAdapter(),
): Promise<void> {
	const cacheDir = getCacheDir(config);

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
			const cache = await readCache(cacheDir, namespace, language, fs);
			Object.entries(flattenJson(content)).forEach(([key, translation]) => {
				// Skip keys that does not exist in source locale
				if (!sourceNamespaceContent[namespace]?.has(key)) return;

				const sourceValue = sourceNamespaceContent[namespace].get(key);
				cache[key] = {
					hash: computeHash(String(sourceValue)),
					translation: String(translation),
				};
			});

			// Persist cache immediately after each successful chunk
			await writeCache(cacheDir, namespace, language, cache, fs);
		}
	}
}
