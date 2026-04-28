import type { FsAdapter } from '../../src/types.js';

/**
 * Simple in-memory FsAdapter backed by a Map.
 * Suitable for tests that don't need readdir (e.g. cache tests).
 */
export function makeSimpleMemFs(initial: Record<string, string> = {}): FsAdapter {
	const store = new Map<string, string>(Object.entries(initial));

	return {
		async readFile(path) {
			const data = store.get(path);
			if (data === undefined) throw new Error(`ENOENT: ${path}`);
			return data;
		},
		async writeFile(path, data) {
			store.set(path, data);
		},
		async mkdir() {
			return undefined;
		},
		async readdir() {
			return [];
		},
		async access(path) {
			if (!store.has(path)) throw new Error(`ENOENT: ${path}`);
		},
	};
}

/**
 * Full in-memory FsAdapter backed by a Map.
 * Supports readdir by scanning stored paths for direct children.
 * Returns both the adapter and the underlying store for inspection.
 */
export function makeMemFs(initial: Record<string, string> = {}): {
	fs: FsAdapter;
	store: Map<string, string>;
} {
	const store = new Map<string, string>(Object.entries(initial));

	const fs: FsAdapter = {
		async readFile(path) {
			const data = store.get(path);
			if (data === undefined) throw new Error(`ENOENT: ${path}`);
			return data;
		},
		async writeFile(path, data) {
			store.set(path, data);
		},
		async mkdir() {
			return undefined;
		},
		async readdir(path) {
			const prefix = path.endsWith('/') ? path : `${path}/`;
			const children = new Set<string>();
			for (const key of store.keys()) {
				if (key.startsWith(prefix)) {
					const rest = key.slice(prefix.length);
					const segment = rest.split('/')[0];
					if (segment) children.add(segment);
				}
			}
			return Array.from(children);
		},
		async access(path) {
			if (!store.has(path)) throw new Error(`ENOENT: ${path}`);
		},
	};

	return { fs, store };
}
