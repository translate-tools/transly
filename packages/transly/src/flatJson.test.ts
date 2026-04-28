/* eslint-disable camelcase */
import { describe, expect, it } from 'vitest';

import { flattenJson, unflattenJson } from './flatten';

/*
 * Every flatten - unflatten round-trip must be lossless
 */
function roundtrip(obj: Record<string, unknown>) {
	expect(unflattenJson(flattenJson(structuredClone(obj)))).toStrictEqual(obj);
}

describe('flattenJson', () => {
	it('flattens a simple nested object', () => {
		expect(flattenJson({ a: { b: 'hello' } })).toEqual({ 'a.b': 'hello' });
	});

	it('flattens deeply nested object', () => {
		expect(flattenJson({ a: { b: { c: { d: 'deep' } } } })).toEqual({
			'a.b.c.d': 'deep',
		});
	});

	it('flattens array of primitives', () => {
		expect(flattenJson({ tags: ['web', 'mobile'] })).toEqual({
			'tags[0]': 'web',
			'tags[1]': 'mobile',
		});
	});

	it('flattens array of objects', () => {
		expect(flattenJson({ team: [{ name: 'Alice' }, { name: 'Bob' }] })).toEqual({
			'team[0].name': 'Alice',
			'team[1].name': 'Bob',
		});
	});

	it('flattens nested arrays', () => {
		expect(
			flattenJson({
				matrix: [
					['a', 'b'],
					['c', 'd'],
				],
			}),
		).toEqual({
			'matrix[0][0]': 'a',
			'matrix[0][1]': 'b',
			'matrix[1][0]': 'c',
			'matrix[1][1]': 'd',
		});
	});

	it('escapes dot in key name', () => {
		expect(flattenJson({ 'foo.bar': 'baz' })).toEqual({ '["foo.bar"]': 'baz' });
	});

	it('escapes bracket in key name', () => {
		expect(flattenJson({ 'foo[0]': 'baz' })).toEqual({ '["foo[0]"]': 'baz' });
	});

	it('escapes quote in key name', () => {
		expect(flattenJson({ 'foo"bar': 'baz' })).toEqual({ '["foo\\"bar"]': 'baz' });
	});

	it('escapes backslash in key name', () => {
		expect(flattenJson({ 'foo\\bar': 'baz' })).toEqual({ '["foo\\\\bar"]': 'baz' });
	});

	it('escapes dot in nested key name', () => {
		expect(flattenJson({ a: { 'b.c': 'val' } })).toEqual({ 'a["b.c"]': 'val' });
	});

	it('keeps the values unmodified', () => {
		expect(flattenJson({ a: 42 })).toEqual({ a: 42 });
		expect(flattenJson({ a: true })).toEqual({ a: true });
		expect(flattenJson({ a: null })).toEqual({ a: null });
	});

	it('transform values', () => {
		expect(flattenJson({ a: 42, b: true, c: null }, String)).toEqual({
			a: '42',
			b: 'true',
			c: 'null',
		});
	});
});

describe('unflattenJson', () => {
	it('unflattens a simple path', () => {
		expect(unflattenJson({ 'a.b': 'hello' })).toEqual({ a: { b: 'hello' } });
	});

	it('unflattens multiple sibling keys', () => {
		expect(unflattenJson({ 'a.b': '1', 'a.c': '2' })).toEqual({
			a: { b: '1', c: '2' },
		});
	});

	it('unflattens array of primitives', () => {
		expect(unflattenJson({ 'tags[0]': 'web', 'tags[1]': 'mobile' })).toEqual({
			tags: ['web', 'mobile'],
		});
	});

	it('unflattens array of objects', () => {
		expect(unflattenJson({ 'team[0].name': 'Alice', 'team[1].name': 'Bob' })).toEqual(
			{
				team: [{ name: 'Alice' }, { name: 'Bob' }],
			},
		);
	});

	it('unflattens escaped dot in key', () => {
		expect(unflattenJson({ '["foo.bar"]': 'baz' })).toEqual({ 'foo.bar': 'baz' });
	});

	it('unflattens escaped quote in key', () => {
		expect(unflattenJson({ '["foo\\"bar"]': 'baz' })).toEqual({ 'foo"bar': 'baz' });
	});

	it('unflattens escaped backslash in key', () => {
		expect(unflattenJson({ '["foo\\\\bar"]': 'baz' })).toEqual({ 'foo\\bar': 'baz' });
	});
});

describe('round-trips', () => {
	it('simple object', () => roundtrip({ a: { b: 'hello' } }));

	it('array of strings', () => roundtrip({ tags: ['web', 'mobile'] }));

	it('array of objects', () => roundtrip({ team: [{ name: 'Alice', role: 'admin' }] }));

	it('nested arrays', () => roundtrip({ matrix: [['a', 'b'], ['c']] }));

	it('dot in key name', () => roundtrip({ 'foo.bar': 'baz' }));

	it('bracket in key name', () => roundtrip({ 'foo[0]': 'baz' }));

	it('quote in key name', () => roundtrip({ 'foo"bar': 'baz' }));

	it('backslash in key name', () => roundtrip({ 'foo\\bar': 'baz' }));

	it('mixed special chars in key', () => roundtrip({ 'a.b["c\\d\']': 'v' }));

	it('deeply nested with special keys', () => {
		roundtrip({
			app: {
				'server.config': {
					host: 'localhost',
					tags: ['a', 'b'],
				},
			},
		});
	});

	it('full complex object', () => {
		roundtrip({
			app: {
				title: 'My App',
				errors: {
					not_found: 'Page not found',
					'server.error': 'Internal error',
				},
				tags: ['web', 'mobile'],
				team: [
					{ name: 'Alice', role: 'admin' },
					{ name: 'Bob', role: 'user' },
				],
			},
		});
	});
});
