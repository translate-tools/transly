import { describe, expect, it } from 'vitest';

import { flattenJson, unflattenJson } from '../src/flatten.js';

describe('flattenJson', () => {
	it('flattens a simple flat object unchanged', () => {
		expect(flattenJson({ title: 'Hello', action: 'Save' })).toEqual({
			title: 'Hello',
			action: 'Save',
		});
	});

	it('flattens one level of nesting', () => {
		expect(flattenJson({ nested: { message: 'World' } })).toEqual({
			'nested.message': 'World',
		});
	});

	it('flattens multiple levels of nesting', () => {
		expect(flattenJson({ a: { b: { c: 'deep' } } })).toEqual({ 'a.b.c': 'deep' });
	});

	it('flattens mixed flat and nested keys', () => {
		const input = {
			title: 'Hello',
			nested: { message: 'World', sub: { value: 'deep' } },
		};
		expect(flattenJson(input)).toEqual({
			title: 'Hello',
			'nested.message': 'World',
			'nested.sub.value': 'deep',
		});
	});

	it('handles empty object', () => {
		expect(flattenJson({})).toEqual({});
	});

	it('coerces non-string leaf values to strings', () => {
		const input = {
			count: 42 as unknown,
			flag: true as unknown,
			nothing: null as unknown,
		};
		const result = flattenJson(input as Record<string, unknown>);
		expect(result['count']).toBe(42);
		expect(result['flag']).toBe(true);
		expect(result['nothing']).toBe(null);
	});

	it('handles real-world i18n structure', () => {
		const input = {
			tag: {
				editor: { mode: { add: { title: 'Create tag', action: 'Create' } } },
				suggests: ['fancy', 'tag name', 'ideas'],
			},
		};
		expect(flattenJson(input)).toEqual({
			'tag.editor.mode.add.title': 'Create tag',
			'tag.editor.mode.add.action': 'Create',
			'tag.suggests[0]': 'fancy',
			'tag.suggests[1]': 'tag name',
			'tag.suggests[2]': 'ideas',
		});
	});
});

describe('unflattenJson', () => {
	it('reconstructs a simple flat object', () => {
		expect(unflattenJson({ title: 'Hello', action: 'Save' })).toEqual({
			title: 'Hello',
			action: 'Save',
		});
	});

	it('reconstructs one level of nesting', () => {
		expect(unflattenJson({ 'nested.message': 'World' })).toEqual({
			nested: { message: 'World' },
		});
	});

	it('reconstructs multiple levels of nesting', () => {
		expect(unflattenJson({ 'a.b.c': 'deep' })).toEqual({ a: { b: { c: 'deep' } } });
	});

	it('reconstructs mixed flat and nested keys', () => {
		const input = {
			title: 'Hello',
			'nested.message': 'World',
			'nested.sub.value': 'deep',
		};
		expect(unflattenJson(input)).toEqual({
			title: 'Hello',
			nested: { message: 'World', sub: { value: 'deep' } },
		});
	});

	it('handles empty object', () => {
		expect(unflattenJson({})).toEqual({});
	});
});

describe('flattenJson + unflattenJson round-trip', () => {
	it('round-trips a simple object', () => {
		const original = { title: 'Hello', action: 'Save' };
		expect(unflattenJson(flattenJson(original))).toEqual(original);
	});

	it('round-trips a deeply nested object', () => {
		const original = {
			tag: {
				editor: {
					mode: {
						add: { title: 'Create tag', action: 'Create' },
						edit: { title: 'Edit tag', action: 'Save' },
					},
				},
			},
		};
		expect(unflattenJson(flattenJson(original))).toEqual(original);
	});

	it('round-trips an empty object', () => {
		expect(unflattenJson(flattenJson({}))).toEqual({});
	});
});
