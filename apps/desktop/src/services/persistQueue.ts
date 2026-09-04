/**
 * Serialises writes to the on-disk store and reports failures.
 *
 * Two problems this fixes. Writes were fired as `void save…()` from several
 * store actions, so a read-modify-write (removing an org) could interleave with
 * another write and lose the change. And a failed write — disk full, file
 * locked, permissions — was swallowed entirely: the UI reported success and the
 * data was simply gone on next launch.
 *
 * Everything queues behind a single promise chain, so writes land in the order
 * they were requested.
 */

let tail: Promise<unknown> = Promise.resolve();

type FailureListener = (message: string) => void;
const listeners = new Set<FailureListener>();

/** Notified when a persisted write fails, so the UI can say so. */
export function onPersistFailure(listener: FailureListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Queues a write. Returns a promise that resolves once it has been attempted —
 * callers that cannot await it still get failures reported through the
 * listeners above rather than silence.
 */
export function persist<T>(
  label: string,
  write: () => Promise<T>,
): Promise<T | undefined> {
  const queued = tail.then(async () => {
    try {
      return await write();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = `Could not save ${label}: ${message}`;
      for (const listener of listeners) listener(detail);
      console.error(detail);
      return undefined;
    }
  });

  // The chain must not break on failure, or every later write would be skipped.
  tail = queued.catch(() => undefined);
  return queued;
}
