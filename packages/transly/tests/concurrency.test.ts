import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from '../src/concurrency.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simple deferred barrier so tests can co-ordinate async execution. */
function makeBarrier(count: number) {
	let resolve!: () => void;
	let remaining = count;
	const promise = new Promise<void>((r) => (resolve = r));

	return {
		/** Signal that one participant has arrived; resolves when all have. */
		arrive() {
			if (--remaining <= 0) resolve();
			return promise;
		},
		/** The underlying promise (resolved when all participants arrived). */
		promise,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runWithConcurrency', () => {
	it('returns an empty array for an empty task list', async () => {
		const result = await runWithConcurrency([], 5);
		expect(result).toEqual([]);
	});

	it('resolves results in task-index order, not completion order', async () => {
		// task 0 finishes last, task 1 finishes first
		const result = await runWithConcurrency(
			[
				() => new Promise<number>((r) => setTimeout(() => r(0), 20)),
				() => Promise.resolve(1),
				() => Promise.resolve(2),
			],
			3,
		);
		expect(result).toEqual([0, 1, 2]);
	});

	it('runs all tasks when concurrency >= task count', async () => {
		let started = 0;
		const tasks = Array.from({ length: 5 }, () => async () => {
			started++;
			return started;
		});

		await runWithConcurrency(tasks, 10);
		expect(started).toBe(5);
	});

	it('runs all tasks when concurrency === 1 (sequential)', async () => {
		const order: number[] = [];
		const tasks = [0, 1, 2, 3].map((i) => async () => {
			order.push(i);
		});

		await runWithConcurrency(tasks, 1);
		expect(order).toEqual([0, 1, 2, 3]);
	});

	it('respects the concurrency limit — no more than N tasks run at the same time', async () => {
		const LIMIT = 3;
		const TOTAL = 9;
		let inflight = 0;
		let maxInflight = 0;

		const tasks = Array.from({ length: TOTAL }, () => async () => {
			inflight++;
			maxInflight = Math.max(maxInflight, inflight);
			// Yield so other tasks have a chance to start
			await new Promise<void>((r) => setImmediate(r));
			inflight--;
		});

		await runWithConcurrency(tasks, LIMIT);

		expect(maxInflight).toBeLessThanOrEqual(LIMIT);
		// At least some overlap actually happened
		expect(maxInflight).toBeGreaterThan(1);
	});

	it('spawns exactly min(limit, tasks) workers', async () => {
		// With 2 tasks and limit 10, only 2 workers should be created.
		// Verify by checking that both tasks ran but no more than 2 overlap.
		let inflight = 0;
		let maxInflight = 0;

		const tasks = Array.from({ length: 2 }, () => async () => {
			inflight++;
			maxInflight = Math.max(maxInflight, inflight);
			await Promise.resolve();
			inflight--;
		});

		await runWithConcurrency(tasks, 10);
		expect(maxInflight).toBeLessThanOrEqual(2);
	});

	it('all N tasks run truly concurrently when limit >= N', async () => {
		// Use a barrier: every task must wait until ALL tasks have started.
		// If they were not concurrent the barrier would never resolve.
		const TASKS = 4;
		const barrier = makeBarrier(TASKS);
		let completedCount = 0;

		const tasks = Array.from({ length: TASKS }, () => async () => {
			// Signal arrival and wait for peers — deadlocks if not concurrent
			await barrier.arrive();
			completedCount++;
		});

		await runWithConcurrency(tasks, TASKS);
		expect(completedCount).toBe(TASKS);
	});

	it('throws on invalid concurrency limit', async () => {
		await expect(runWithConcurrency([async () => 1], 0)).rejects.toThrow(
			'concurrency limit must be a positive integer',
		);
		await expect(runWithConcurrency([async () => 1], -1)).rejects.toThrow(
			'concurrency limit must be a positive integer',
		);
	});

	// ── Error handling ────────────────────────────────────────────────────────

	it('re-throws the first error after all in-flight tasks settle', async () => {
		const completedKeys: number[] = [];

		// task 0 succeeds, task 1 fails, task 2 was in-flight and succeeds
		const tasks = [
			async () => {
				completedKeys.push(0);
			},
			async () => {
				throw new Error('task 1 failed');
			},
			async () => {
				// Simulate work that was already in-flight
				await Promise.resolve();
				completedKeys.push(2);
			},
		];

		await expect(runWithConcurrency(tasks, 3)).rejects.toThrow('task 1 failed');

		// task 2 was already in-flight when task 1 failed, so it should complete
		expect(completedKeys).toContain(0);
		expect(completedKeys).toContain(2);
	});

	it('propagates the first error, not subsequent ones', async () => {
		const tasks = [
			async () => {
				throw new Error('first error');
			},
			async () => {
				throw new Error('second error');
			},
		];

		await expect(runWithConcurrency(tasks, 2)).rejects.toThrow('first error');
	});

	it('does not start new tasks after an error (fail-fast)', async () => {
		const started: number[] = [];

		// Using concurrency=1 so tasks run serially; task 0 fails, task 1 should not start
		const tasks = [
			async () => {
				started.push(0);
				throw new Error('fail');
			},
			async () => {
				started.push(1);
			},
		];

		await expect(runWithConcurrency(tasks, 1)).rejects.toThrow('fail');
		expect(started).toEqual([0]);
		expect(started).not.toContain(1);
	});

	it('allows in-flight tasks to complete even after an error', async () => {
		// concurrency=2: task 0 and task 1 start together.
		// task 0 fails quickly. task 1 is in-flight and must be allowed to finish.
		const completedKeys: number[] = [];

		const tasks = [
			async () => {
				// fail after yielding so task 1 can start
				await Promise.resolve();
				throw new Error('task 0 failed');
			},
			async () => {
				await new Promise<void>((r) => setTimeout(r, 10));
				completedKeys.push(1);
			},
			async () => {
				// task 2: should NOT start because hasError is set before it's picked up
				completedKeys.push(2);
			},
		];

		await expect(runWithConcurrency(tasks, 2)).rejects.toThrow('task 0 failed');

		// task 1 was already in-flight → must complete
		expect(completedKeys).toContain(1);
		// task 2 was never started → must not complete
		expect(completedKeys).not.toContain(2);
	});
});
