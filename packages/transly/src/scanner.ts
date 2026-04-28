import { join } from 'path';

import type { FsAdapter } from './types.js';

/**
 * Represents a discovered namespace file in the source locale directory.
 */
export type NamespaceFile = {
	/** Namespace name derived from the filename without extension (e.g. "features") */
	namespace: string;
	/** Full path to the source JSON file */
	filePath: string;
	/** Parsed JSON content of the file */
	content: Record<string, unknown>;
};

/**
 * Scans the source locale directory and returns all namespace files.
 *
 * Expects the structure:
 *   <localesDir>/<sourceLang>/<namespace>.json
 *
 * @param localesDir - Root locales directory
 * @param sourceLang - Source language code (e.g. "en")
 * @param fs - Filesystem adapter
 */
export async function scanNamespaces(
	localesDir: string,
	sourceLang: string,
	fs: FsAdapter,
): Promise<NamespaceFile[]> {
	const sourceLangDir = join(localesDir, sourceLang);

	let entries: string[];
	try {
		entries = await fs.readdir(sourceLangDir);
	} catch (err) {
		throw new Error(
			`Cannot read source locale directory "${sourceLangDir}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const jsonFiles = entries.filter((entry) => entry.endsWith('.json'));

	const results: NamespaceFile[] = [];

	for (const filename of jsonFiles) {
		const namespace = filename.slice(0, -5); // strip ".json"
		const filePath = join(sourceLangDir, filename);

		let content: Record<string, unknown>;
		try {
			const raw = await fs.readFile(filePath, 'utf-8');
			content = JSON.parse(raw) as Record<string, unknown>;
		} catch (err) {
			throw new Error(
				`Failed to read/parse namespace file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		results.push({ namespace, filePath, content });
	}

	return results;
}
