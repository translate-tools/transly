/** Default number of concurrent translation workers */
export const DEFAULT_CONCURRENCY = 10;

/**
 * Runs an array of async task factories with bounded concurrency.
 *
 * Spawns `Math.min(limit, tasks.length)` worker coroutines.  Each worker
 * pulls the next task from a shared index until the list is exhausted.
 *
 * Error handling:
 *   - When any task throws, no *new* tasks are started (fail-fast).
 *   - Tasks that are already in-flight at the time of failure are allowed to
 *     settle, so their side-effects (e.g. cache writes) are preserved.
 *   - The first error is re-thrown after all workers have finished.
 *
 * @param tasks     Array of zero-argument async functions to execute.
 * @param limit     Maximum number of tasks that may run simultaneously.
 * @returns         Array of resolved values in the same order as `tasks`.
 */
export async function runWithConcurrency<T>(
	tasks: Array<() => Promise<T>>,
	limit: number,
): Promise<T[]> {
	if (limit <= 0) throw new Error('concurrency limit must be a positive integer');
	if (tasks.length === 0) return [];

	const results: T[] = new Array<T>(tasks.length);
	let nextIndex = 0;
	let firstError: unknown;
	let hasError = false;

	async function worker(): Promise<void> {
		// Keep picking tasks until the list is exhausted or an error was seen.
		while (nextIndex < tasks.length && !hasError) {
			const idx = nextIndex++;
			try {
				results[idx] = await tasks[idx]();
			} catch (err) {
				if (!hasError) {
					firstError = err;
					hasError = true;
				}
			}
		}
	}

	const workerCount = Math.min(limit, tasks.length);
	const workers = Array.from({ length: workerCount }, () => worker());

	// Wait for all workers to finish (in-flight tasks may still complete after
	// an error is captured, which is intentional for cache-safety).
	await Promise.all(workers);

	if (hasError) throw firstError;
	return results;
}
