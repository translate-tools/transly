import { describe, expect, it } from 'vitest';

import { ProgressRenderer } from '../src/progressRenderer';
import type { ProgressEvent } from '../src/runner';

function makeRenderer(isTTY: boolean) {
	const lines: string[] = [];
	const writes: string[] = [];

	const renderer = new ProgressRenderer({
		isTTY,
		log: (line) => lines.push(line),
		write: (text) => writes.push(text),
		now: () => 0,
	});

	return { renderer, lines, writes };
}

function feed(renderer: ProgressRenderer, events: ProgressEvent[]) {
	for (const event of events) {
		renderer.onEvent(event);
	}
}

const SCAN: Extract<ProgressEvent, { type: 'scan_complete' }> = {
	type: 'scan_complete',
	namespaces: 2,
	targetLangs: 2,
	totalTasks: 4,
	totalKeys: 5,
};

const TASK_START_DE: Extract<ProgressEvent, { type: 'task_start' }> = {
	type: 'task_start',
	namespace: 'notes',
	targetLang: 'de',
	totalKeys: 3,
	changedKeys: 3,
};

const TASK_DONE_DE: Extract<ProgressEvent, { type: 'task_done' }> = {
	type: 'task_done',
	namespace: 'notes',
	targetLang: 'de',
};

const TASK_START_FR: Extract<ProgressEvent, { type: 'task_start' }> = {
	type: 'task_start',
	namespace: 'notes',
	targetLang: 'fr',
	totalKeys: 3,
	changedKeys: 0,
};

const TASK_SKIP_FR: Extract<ProgressEvent, { type: 'task_skip' }> = {
	type: 'task_skip',
	namespace: 'notes',
	targetLang: 'fr',
};

const CHUNK_DONE: Extract<ProgressEvent, { type: 'chunk_done' }> = {
	type: 'chunk_done',
	namespace: 'notes',
	targetLang: 'de',
	chunkIndex: 0,
	totalChunks: 2,
	chunkSize: 2,
};

describe('ProgressRenderer — non-TTY', () => {
	it('scan_complete emits a summary line', () => {
		const { renderer, lines } = makeRenderer(false);
		renderer.onEvent(SCAN);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('2 namespace(s)');
		expect(lines[0]).toContain('2 language(s)');
		expect(lines[0]).toContain('4 task(s)');
		expect(lines[0]).toContain('5 keys total');
	});

	it('task_start with changed keys emits a [start] line', () => {
		const { renderer, lines } = makeRenderer(false);
		renderer.onEvent(TASK_START_DE);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('[start]');
		expect(lines[0]).toContain('[de]');
		expect(lines[0]).toContain('notes');
		expect(lines[0]).toContain('3/3');
	});

	it('task_start with no changed keys emits nothing', () => {
		const { renderer, lines } = makeRenderer(false);
		renderer.onEvent(TASK_START_FR);
		expect(lines).toHaveLength(0);
	});

	it('chunk_done is silent in non-TTY mode', () => {
		const { renderer, lines } = makeRenderer(false);
		renderer.onEvent(TASK_START_DE);
		lines.length = 0;
		renderer.onEvent(CHUNK_DONE);
		expect(lines).toHaveLength(0);
	});

	it('task_done emits a [done] line', () => {
		const { renderer, lines } = makeRenderer(false);
		renderer.onEvent(TASK_START_DE);
		lines.length = 0;
		renderer.onEvent(TASK_DONE_DE);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('[done]');
		expect(lines[0]).toContain('[de]');
		expect(lines[0]).toContain('notes');
		expect(lines[0]).toContain('3 key(s)');
	});

	it('task_skip emits a [skip] line', () => {
		const { renderer, lines } = makeRenderer(false);
		renderer.onEvent(TASK_START_FR);
		renderer.onEvent(TASK_SKIP_FR);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('[skip]');
		expect(lines[0]).toContain('[fr]');
		expect(lines[0]).toContain('no changes');
	});

	it('printSummary emits a completion line', () => {
		const { renderer, lines } = makeRenderer(false);
		feed(renderer, [SCAN, TASK_START_DE, TASK_DONE_DE, TASK_START_FR, TASK_SKIP_FR]);
		lines.length = 0;
		renderer.printSummary();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('✅');
		expect(lines[0]).toContain('2 task(s)');
		expect(lines[0]).toContain('0.0s');
	});

	it('full non-TTY run matches snapshot', () => {
		const { renderer, lines } = makeRenderer(false);
		feed(renderer, [
			SCAN,
			TASK_START_DE,
			CHUNK_DONE,
			TASK_DONE_DE,
			TASK_START_FR,
			TASK_SKIP_FR,
		]);
		renderer.printSummary();
		expect(lines).toMatchSnapshot();
	});
});

describe('ProgressRenderer — TTY', () => {
	it('scan_complete writes a header via write()', () => {
		const { renderer, writes } = makeRenderer(true);
		renderer.onEvent(SCAN);
		const combined = writes.join('');
		expect(combined).toContain('2 namespaces');
		expect(combined).toContain('2 languages');
		expect(combined).toContain('4 tasks');
		expect(combined).toContain('5 keys');
	});

	it('task_start triggers a table redraw', () => {
		const { renderer, writes } = makeRenderer(true);
		renderer.onEvent(SCAN);
		const before = writes.length;
		renderer.onEvent(TASK_START_DE);
		expect(writes.length).toBeGreaterThan(before);
	});

	it('chunk_done triggers a table redraw', () => {
		const { renderer, writes } = makeRenderer(true);
		renderer.onEvent(SCAN);
		renderer.onEvent(TASK_START_DE);
		const before = writes.length;
		renderer.onEvent(CHUNK_DONE);
		expect(writes.length).toBeGreaterThan(before);
	});

	it('table contains task rows after events', () => {
		const { renderer, writes } = makeRenderer(true);
		feed(renderer, [SCAN, TASK_START_DE, TASK_DONE_DE]);
		const combined = writes.join('');
		expect(combined).toContain('[de]');
		expect(combined).toContain('notes');
	});

	it('uses ANSI cursor-up escape to erase previous table on redraw', () => {
		const { renderer, writes } = makeRenderer(true);
		renderer.onEvent(SCAN);
		renderer.onEvent(TASK_START_DE);
		renderer.onEvent(TASK_DONE_DE);
		const combined = writes.join('');
		expect(combined).toContain('\x1b[');
	});

	it('cursor-up escape count matches the number of lines actually written', () => {
		const { renderer, writes } = makeRenderer(true);

		// First draw: 1 task row + 1 footer line → 2 lines written (rows.length + 1 = 2)
		renderer.onEvent(SCAN);
		renderer.onEvent(TASK_START_DE);

		// Second draw: triggers the erase+redraw, so a cursor-up escape is emitted
		renderer.onEvent(CHUNK_DONE);

		// Collect all cursor-up escapes produced during redraws
		// eslint-disable-next-line no-control-regex
		const upEscapes = writes.filter((w) => /^\x1b\[\d+A$/.test(w));
		expect(upEscapes.length).toBeGreaterThan(0);

		// 1 row + 1 footer = 2 lines → cursor must move up exactly 2, not 3
		expect(upEscapes[0]).toBe('\x1b[2A');
	});

	it('printSummary emits a completion line via log()', () => {
		const { renderer, lines } = makeRenderer(true);
		feed(renderer, [SCAN, TASK_START_DE, TASK_DONE_DE]);
		renderer.printSummary();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('✅');
		expect(lines[0]).toContain('0.0s');
	});

	it('full TTY run matches snapshot', () => {
		const { renderer, writes, lines } = makeRenderer(true);
		feed(renderer, [
			SCAN,
			TASK_START_DE,
			CHUNK_DONE,
			TASK_DONE_DE,
			TASK_START_FR,
			TASK_SKIP_FR,
		]);
		renderer.printSummary();
		expect({ writes, lines }).toMatchSnapshot();
	});

	it('progress bar shows full block when task is done', () => {
		const { renderer, writes } = makeRenderer(true);
		feed(renderer, [SCAN, TASK_START_DE, TASK_DONE_DE]);
		const combined = writes.join('');
		expect(combined).toContain('██████████');
	});

	it('progress bar shows empty when task is active with 0 processed keys', () => {
		const { renderer, writes } = makeRenderer(true);
		feed(renderer, [SCAN, TASK_START_DE]);
		const combined = writes.join('');
		expect(combined).toContain('░░░░░░░░░░');
	});

	it('footer shows correct task count', () => {
		const { renderer, writes } = makeRenderer(true);
		feed(renderer, [SCAN, TASK_START_DE, TASK_DONE_DE, TASK_START_FR, TASK_SKIP_FR]);
		const combined = writes.join('');
		expect(combined).toContain('2/4 tasks done');
	});
});
