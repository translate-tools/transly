import type { ProgressEvent } from './runner';

type TaskStatus = 'queued' | 'active' | 'done' | 'skipped';

interface TaskState {
	namespace: string;
	targetLang: string;
	status: TaskStatus;
	totalKeys: number;
	changedKeys: number;
	doneChunks: number;
	totalChunks: number;
	processedKeys: number;
}

export interface ProgressRendererOptions {
	isTTY: boolean;
	/** Write raw text to the output stream (default: `process.stdout.write`). */
	write?: (text: string) => void;
	/** Emit a complete log line (default: `console.log`). */
	log?: (line: string) => void;
	/** Returns the current timestamp in ms (default: `Date.now`). */
	now?: () => number;
}

/**
 * Renders translation progress in one of two modes:
 *
 * - TTY: maintains an in-place table using ANSI cursor controls, redrawn on
 *   every event. Nothing scrolls until the run completes.
 * - Non-TTY: emits plain timestamped log lines. `chunk_done` events are
 *   suppressed to avoid log spam.
 */
export class ProgressRenderer {
	private readonly isTTY: boolean;
	private readonly write: (text: string) => void;
	private readonly log: (line: string) => void;
	private readonly now: () => number;

	private readonly tasks: Map<string, TaskState> = new Map();
	private totalTasks = 0;
	private doneTasks = 0;
	private tableLines = 0;
	private readonly startTime: number;

	constructor(options: ProgressRendererOptions) {
		this.isTTY = options.isTTY;
		this.write = options.write ?? ((text) => process.stdout.write(text));
		this.log =
			options.log ??
			((line) => {
				console.log(line);
			});
		this.now = options.now ?? (() => Date.now());
		this.startTime = this.now();
	}

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

	/** Call once after `runTranslation` resolves. */
	printSummary(): void {
		const elapsed = this.elapsedSeconds();
		if (this.isTTY) {
			this.redrawTable();
		}
		this.log(`\n✅ Translation complete — ${this.doneTasks} task(s) in ${elapsed}s`);
	}

	private taskKey(namespace: string, targetLang: string): string {
		return `${targetLang}:${namespace}`;
	}

	private elapsedSeconds(): string {
		return ((this.now() - this.startTime) / 1000).toFixed(1);
	}

	private handleScanComplete(
		event: Extract<ProgressEvent, { type: 'scan_complete' }>,
	): void {
		this.totalTasks = event.totalTasks;

		const ns = event.namespaces;
		const langs = event.targetLangs;
		const tasks = event.totalTasks;
		const keys = event.totalKeys;

		if (this.isTTY) {
			this.write(
				`Translating ${ns} namespace${ns !== 1 ? 's' : ''} × ` +
					`${langs} language${langs !== 1 ? 's' : ''} = ` +
					`${tasks} task${tasks !== 1 ? 's' : ''} ` +
					`(${keys} keys)\n\n`,
			);
		} else {
			this.logLine(
				`Found ${ns} namespace(s) × ${langs} language(s) = ${tasks} task(s), ${keys} keys total`,
			);
		}
	}

	private handleTaskStart(event: Extract<ProgressEvent, { type: 'task_start' }>): void {
		const key = this.taskKey(event.namespace, event.targetLang);
		const existing = this.tasks.get(key);
		this.tasks.set(key, {
			namespace: event.namespace,
			targetLang: event.targetLang,
			status: 'active',
			totalKeys: event.totalKeys,
			changedKeys: event.changedKeys,
			doneChunks: existing?.doneChunks ?? 0,
			totalChunks: existing?.totalChunks ?? 0,
			processedKeys: existing?.processedKeys ?? 0,
		});

		if (this.isTTY) {
			this.redrawTable();
		} else if (event.changedKeys > 0) {
			this.logLine(
				`[start] [${event.targetLang}] ${event.namespace}: ${event.changedKeys}/${event.totalKeys} keys to translate`,
			);
		}
	}

	private handleChunkDone(event: Extract<ProgressEvent, { type: 'chunk_done' }>): void {
		const task = this.tasks.get(this.taskKey(event.namespace, event.targetLang));
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
		const task = this.tasks.get(this.taskKey(event.namespace, event.targetLang));
		if (task) {
			task.status = 'done';
			task.processedKeys = task.changedKeys;
		}
		this.doneTasks++;

		if (this.isTTY) {
			this.redrawTable();
		} else {
			const keys = task?.changedKeys ?? 0;
			this.logLine(
				`[done]  [${event.targetLang}] ${event.namespace}: ${keys} key(s) translated`,
			);
		}
	}

	private handleTaskSkip(event: Extract<ProgressEvent, { type: 'task_skip' }>): void {
		const task = this.tasks.get(this.taskKey(event.namespace, event.targetLang));
		if (task) task.status = 'skipped';
		this.doneTasks++;

		if (this.isTTY) {
			this.redrawTable();
		} else {
			this.logLine(`[skip]  [${event.targetLang}] ${event.namespace}: no changes`);
		}
	}

	private redrawTable(): void {
		if (this.tableLines > 0) {
			this.write(`\x1b[${this.tableLines}A`);
			this.write('\x1b[0J');
		}

		const rows = this.buildTableRows();
		const footer = this.buildFooter();
		const output = [...rows, footer, ''].join('\n');

		this.write(output);
		this.tableLines = rows.length + 1;
	}

	private buildTableRows(): string[] {
		const order: Record<TaskStatus, number> = {
			done: 0,
			skipped: 1,
			active: 2,
			queued: 3,
		};
		const sorted = Array.from(this.tasks.values()).sort((a, b) => {
			const od = order[a.status] - order[b.status];
			if (od !== 0) return od;
			return `${a.targetLang}:${a.namespace}`.localeCompare(
				`${b.targetLang}:${b.namespace}`,
			);
		});

		return sorted.map((task) => this.renderTaskRow(task));
	}

	private renderTaskRow(task: TaskState): string {
		const label = `  [${task.targetLang}] ${task.namespace}`.padEnd(28, ' ');

		let bar: string;
		let detail: string;

		switch (task.status) {
			case 'queued':
				bar = this.buildBar(0);
				detail = 'queued';
				break;

			case 'active': {
				const fraction =
					task.changedKeys > 0 ? task.processedKeys / task.changedKeys : 0;
				bar = this.buildBar(fraction);
				detail =
					task.totalChunks > 1
						? `chunk ${task.doneChunks + 1}/${task.totalChunks}  (${task.processedKeys}/${task.changedKeys} keys)`
						: `translating…  (${task.processedKeys}/${task.changedKeys} keys)`;
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

		return `${label}  ${bar}  ${detail}`;
	}

	private buildBar(fraction: number, width = 10): string {
		const filled = Math.round(fraction * width);
		return '█'.repeat(filled) + '░'.repeat(width - filled);
	}

	private buildFooter(): string {
		return `  Progress: ${this.doneTasks}/${this.totalTasks} tasks done  [${this.elapsedSeconds()}s]`;
	}

	private logLine(message: string): void {
		const ts = new Date(this.now()).toISOString().slice(11, 19);
		this.log(`${ts}  ${message}`);
	}
}
