#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'path';

import { description, name, version } from '../package.json';
import { fillCacheFromTranslations } from './cacheUtils';
import { DEFAULT_CONCURRENCY } from './concurrency.js';
import { loadConfig } from './config.js';
import { translateChunk } from './llm';
import { type ProgressEvent, runTranslation } from './runner.js';
import { makeNodeFsAdapter } from './utils/makeNodeFsAdapter';

const program = new Command().name(name).description(description).version(version);

const cache = program.command('cache').description('Cache operations');

cache
	.command('hydrate')
	.alias('restore')
	.alias('seed')
	.description('Fill cache from existing translations')
	.option('-c, --config <path>', 'Path to the i18n config file', './transly.config.js')
	.action(async (options: { config: string }) => {
		const configPath = resolve(options.config);

		console.log(`Loading config from: ${configPath}`);

		let config;
		try {
			config = await loadConfig(configPath);
		} catch (err) {
			console.error(
				`\n❌ Config error: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}

		console.log('Hydrating cache...');
		await fillCacheFromTranslations(config, makeNodeFsAdapter());
	});

// ─── Progress renderer ────────────────────────────────────────────────────────

type TaskStatus = 'queued' | 'active' | 'done' | 'skipped';

interface TaskState {
	namespace: string;
	targetLang: string;
	status: TaskStatus;
	totalKeys: number;
	changedKeys: number;
	doneChunks: number;
	totalChunks: number;
	/** Cumulative keys translated so far (via chunk_done events) */
	processedKeys: number;
}

/**
 * Renders progress in one of two modes:
 *
 *  - **TTY** (interactive terminal): maintains an in-place table using ANSI
 *    cursor controls — one row per task, redrawn on every event.  Nothing
 *    scrolls until the run completes.
 *
 *  - **Non-TTY** (pipe, CI, redirect): emits plain timestamped log lines, no
 *    ANSI codes.  `chunk_done` events are suppressed to avoid log spam.
 */
class ProgressRenderer {
	private readonly isTTY: boolean;
	private readonly tasks: Map<string, TaskState> = new Map();
	private totalTasks = 0;
	private doneTasks = 0;
	private tableLines = 0; // how many lines of the table are currently on screen
	private readonly startTime = Date.now();

	constructor(isTTY: boolean) {
		this.isTTY = isTTY;
	}

	private taskKey(namespace: string, targetLang: string): string {
		return `${targetLang}:${namespace}`;
	}

	// ── Public event handler ──────────────────────────────────────────────────

	onEvent(event: ProgressEvent): void {
		switch (event.type) {
			case 'scan_complete':
				this.handleScanComplete(event);
				break;
			case 'task_start':
				this.handleTaskStart(event);
				break;
			case 'chunk_done':
				this.handleChunkDone(event);
				break;
			case 'task_done':
				this.handleTaskDone(event);
				break;
			case 'task_skip':
				this.handleTaskSkip(event);
				break;
		}
	}

	// ── Event handlers ────────────────────────────────────────────────────────

	private handleScanComplete(
		event: Extract<ProgressEvent, { type: 'scan_complete' }>,
	): void {
		this.totalTasks = event.totalTasks;

		if (this.isTTY) {
			process.stdout.write(
				`Translating ${event.namespaces} namespace${event.namespaces !== 1 ? 's' : ''} × ` +
					`${event.targetLangs} language${event.targetLangs !== 1 ? 's' : ''} = ` +
					`${event.totalTasks} task${event.totalTasks !== 1 ? 's' : ''} ` +
					`(${event.totalKeys} keys)\n\n`,
			);
		} else {
			this.log(
				`Found ${event.namespaces} namespace(s) × ${event.targetLangs} language(s) ` +
					`= ${event.totalTasks} task(s), ${event.totalKeys} keys total`,
			);
		}
	}

	private handleTaskStart(event: Extract<ProgressEvent, { type: 'task_start' }>): void {
		const key = this.taskKey(event.namespace, event.targetLang);
		const existing = this.tasks.get(key);
		this.tasks.set(key, {
			namespace: event.namespace,
			targetLang: event.targetLang,
			// Always overwrite the live fields from the event
			status: 'active',
			totalKeys: event.totalKeys,
			changedKeys: event.changedKeys,
			// Preserve chunk/key progress if the task object already existed
			doneChunks: existing?.doneChunks ?? 0,
			totalChunks: existing?.totalChunks ?? 0,
			processedKeys: existing?.processedKeys ?? 0,
		});

		if (this.isTTY) {
			this.redrawTable();
		} else if (event.changedKeys > 0) {
			this.log(
				`[start] [${event.targetLang}] ${event.namespace}: ${event.changedKeys}/${event.totalKeys} keys to translate`,
			);
		}
	}

	private handleChunkDone(event: Extract<ProgressEvent, { type: 'chunk_done' }>): void {
		const key = this.taskKey(event.namespace, event.targetLang);
		const task = this.tasks.get(key);
		if (!task) return;

		task.doneChunks = event.chunkIndex + 1;
		task.totalChunks = event.totalChunks;
		task.processedKeys += event.chunkSize;

		if (this.isTTY) {
			this.redrawTable();
		}
		// In non-TTY mode chunk_done is intentionally silent (too noisy)
	}

	private handleTaskDone(event: Extract<ProgressEvent, { type: 'task_done' }>): void {
		const key = this.taskKey(event.namespace, event.targetLang);
		const task = this.tasks.get(key);
		if (task) {
			task.status = 'done';
			task.processedKeys = task.changedKeys;
		}
		this.doneTasks++;

		if (this.isTTY) {
			this.redrawTable();
		} else {
			const keys = task?.changedKeys ?? 0;
			this.log(
				`[done]  [${event.targetLang}] ${event.namespace}: ${keys} key(s) translated`,
			);
		}
	}

	private handleTaskSkip(event: Extract<ProgressEvent, { type: 'task_skip' }>): void {
		const key = this.taskKey(event.namespace, event.targetLang);
		const task = this.tasks.get(key);
		if (task) task.status = 'skipped';
		this.doneTasks++;

		if (this.isTTY) {
			this.redrawTable();
		} else {
			this.log(`[skip]  [${event.targetLang}] ${event.namespace}: no changes`);
		}
	}

	// ── TTY rendering ─────────────────────────────────────────────────────────

	/**
	 * Moves the cursor up `this.tableLines` rows (erasing the previous draw)
	 * and redraws the full table.
	 */
	private redrawTable(): void {
		// Erase previously drawn lines
		if (this.tableLines > 0) {
			process.stdout.write(`\x1b[${this.tableLines}A`); // cursor up
			process.stdout.write('\x1b[0J'); // erase from cursor to end of screen
		}

		const rows = this.buildTableRows();
		const footer = this.buildFooter();
		const output = [...rows, footer, ''].join('\n');

		process.stdout.write(output);
		this.tableLines = rows.length + 1 /* footer */ + 1; /* blank line */
	}

	private buildTableRows(): string[] {
		// Sort tasks: done/skipped first (alphabetical), then active, then queued
		const order: Record<TaskStatus, number> = {
			done: 0,
			skipped: 1,
			active: 2,
			queued: 3,
		};
		const sorted = Array.from(this.tasks.values()).sort((a, b) => {
			const od = order[a.status] - order[b.status];
			if (od !== 0) return od;
			const la = `${a.targetLang}:${a.namespace}`;
			const lb = `${b.targetLang}:${b.namespace}`;
			return la.localeCompare(lb);
		});

		return sorted.map((task) => this.renderTaskRow(task));
	}

	private renderTaskRow(task: TaskState): string {
		const label = `  [${task.targetLang}] ${task.namespace}`;
		const paddedLabel = label.padEnd(28, ' ');

		let bar: string;
		let detail: string;

		switch (task.status) {
			case 'queued':
				bar = this.buildBar(0);
				detail = 'queued';
				break;

			case 'active': {
				let fraction = 0;
				if (task.changedKeys > 0) {
					fraction = task.processedKeys / task.changedKeys;
				}
				bar = this.buildBar(fraction);
				if (task.totalChunks > 1) {
					detail = `chunk ${task.doneChunks + 1}/${task.totalChunks}  (${task.processedKeys}/${task.changedKeys} keys)`;
				} else {
					detail = `translating…  (${task.processedKeys}/${task.changedKeys} keys)`;
				}
				break;
			}

			case 'done':
				bar = this.buildBar(1);
				detail = `✓  ${task.changedKeys} key(s) translated`;
				break;

			case 'skipped':
				bar = '──────────';
				detail = '✓  no changes';
				break;
		}

		return `${paddedLabel}  ${bar}  ${detail}`;
	}

	private buildBar(fraction: number, width = 10): string {
		const filled = Math.round(fraction * width);
		return '█'.repeat(filled) + '░'.repeat(width - filled);
	}

	private buildFooter(): string {
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
		return `  Progress: ${this.doneTasks}/${this.totalTasks} tasks done  [${elapsed}s]`;
	}

	// ── Final summary ─────────────────────────────────────────────────────────

	/** Call once after `runTranslation` resolves. */
	printSummary(): void {
		const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
		if (this.isTTY) {
			// Overwrite the live table with the final state one last time, then
			// print a clean completion line below it.
			this.redrawTable();
		}
		console.log(
			`\n✅ Translation complete — ${this.doneTasks} task(s) in ${elapsed}s`,
		);
	}

	// ── Non-TTY helpers ───────────────────────────────────────────────────────

	private log(message: string): void {
		const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
		console.log(`${ts}  ${message}`);
	}
}

// ─── translate command ────────────────────────────────────────────────────────

program
	.command('translate')
	.option('-c, --config <path>', 'Path to the i18n config file', './transly.config.js')
	.option(
		'-j, --concurrency <n>',
		`Number of parallel translation tasks (default: ${DEFAULT_CONCURRENCY})`,
		(v) => {
			const n = parseInt(v, 10);
			if (isNaN(n) || n < 1)
				throw new Error('--concurrency must be a positive integer');
			return n;
		},
	)
	.action(async (options: { config: string; concurrency?: number }) => {
		const configPath = resolve(options.config);

		console.log(`Loading config from: ${configPath}`);

		let config;
		try {
			config = await loadConfig(configPath);
		} catch (err) {
			console.error(
				`\n❌ Config error: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}

		// CLI flag overrides config file value
		if (options.concurrency !== undefined) {
			config = { ...config, concurrency: options.concurrency };
		}

		const effectiveConcurrency = config.concurrency ?? DEFAULT_CONCURRENCY;

		console.log(`Source language:  ${config.sourceLang}`);
		console.log(`Target languages: ${config.targetLangs.join(', ')}`);
		console.log(`Locales dir:      ${config.localesDir}`);
		console.log(`Cache dir:        ${config.cacheDir}`);
		console.log(`Model:            ${config.model}`);
		console.log(`Concurrency:      ${effectiveConcurrency} workers`);
		console.log('');

		const renderer = new ProgressRenderer(process.stdout.isTTY ?? false);

		try {
			await runTranslation(
				config,
				makeNodeFsAdapter(),
				config.translateChunk ?? translateChunk,
				(event) => {
					renderer.onEvent(event);
				},
			);
			renderer.printSummary();
		} catch (err) {
			console.error(
				`\n❌ Translation failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			process.exit(1);
		}
	});

program.parse(process.argv);
