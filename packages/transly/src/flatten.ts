type JsonObject = Record<string, unknown>;

function escapeKey(key: string): string {
	return /[.["\\]/.test(key)
		? `["${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
		: key;
}

/**
 * Recursively flattens a nested JSON object into dot-notation keys.
 *
 * Example:
 *   { nested: { message: "World" } }  →  { "nested.message": "World" }
 *
 * Only string leaf values are included. Non-string leaves (numbers, booleans,
 * null, arrays) are coerced to strings so no data is silently dropped.
 */
export function flattenJson<T extends ((value: unknown) => any) | void>(
	obj: JsonObject,
	transformValue?: T,
): Record<string, T extends (value: unknown) => any ? ReturnType<T> : unknown> {
	const result: Record<
		string,
		T extends (value: unknown) => any ? ReturnType<T> : unknown
	> = {};

	function recurse(value: unknown, path: string): void {
		if (Array.isArray(value)) {
			value.forEach((v, i) => recurse(v, `${path}[${i}]`));
		} else if (value !== null && typeof value === 'object') {
			for (const [k, v] of Object.entries(value as JsonObject)) {
				const seg = escapeKey(k);
				recurse(
					v,
					path ? (seg.startsWith('[') ? path + seg : `${path}.${seg}`) : seg,
				);
			}
		} else {
			// Coerce non-string primitives to string
			// TODO: keep original values, and cast to strings on top level

			result[path] = transformValue ? transformValue(value) : value;
		}
	}

	recurse(obj, '');
	return result;
}
type Token = { key: string; isIndex: boolean };

function parsePath(path: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < path.length) {
		if (path[i] === '.') i++;
		if (i >= path.length) break;

		if (path[i] === '[') {
			// ["key"] — bracket string
			if (path[i + 1] === '"') {
				i += 2;
				let key = '';
				while (i < path.length && path[i] !== '"') {
					// consume escape char
					if (path[i] === '\\') i++;
					key += path[i++];
				}
				// skip closing "]
				i += 2;
				tokens.push({ key, isIndex: false });
				// [0] — array index
			} else {
				const end = path.indexOf(']', i);
				tokens.push({ key: path.slice(i + 1, end), isIndex: true });
				i = end + 1;
			}
			// plain key
		} else {
			const rel = path.slice(i).search(/[.[]/);
			const end = rel === -1 ? path.length : i + rel;
			tokens.push({ key: path.slice(i, end), isIndex: false });
			i = end;
		}
	}

	return tokens;
}

export function unflattenJson(flat: Record<string, string>): JsonObject {
	const result: JsonObject = {};

	for (const [path, value] of Object.entries(flat)) {
		const tokens = parsePath(path);
		if (tokens.length === 0) continue;
		let node: unknown = result;

		for (let i = 0; i < tokens.length - 1; i++) {
			const { key, isIndex } = tokens[i];
			const next = tokens[i + 1];

			if (isIndex) {
				const arr = node as unknown[];
				const idx = Number(key);
				if (!(idx in arr)) arr[idx] = next.isIndex ? [] : {};
				node = arr[idx];
			} else {
				const obj = node as JsonObject;
				if (!(key in obj)) obj[key] = next.isIndex ? [] : {};
				node = obj[key];
			}
		}

		const { key, isIndex } = tokens[tokens.length - 1];
		if (isIndex) (node as unknown[])[Number(key)] = value;
		else (node as JsonObject)[key] = value;
	}

	return result;
}
