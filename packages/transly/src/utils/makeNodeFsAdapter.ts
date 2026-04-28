import nodeFsPromises from 'node:fs/promises';

import type { FsAdapter } from '../types';

/**
 * Builds a default FsAdapter from Node's `fs/promises`.
 */

export function makeNodeFsAdapter(): FsAdapter {
	return {
		readFile: (path, encoding) => nodeFsPromises.readFile(path, { encoding }),
		writeFile: (path, data, encoding) =>
			nodeFsPromises.writeFile(path, data, { encoding }),
		mkdir: (path, options) => nodeFsPromises.mkdir(path, options),
		readdir: (path) => nodeFsPromises.readdir(path),
		access: (path) => nodeFsPromises.access(path),
	};
}
