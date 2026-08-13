import { watch, type FSWatcher } from "node:fs";

const WATCH_RETRY_MS = 2_000;

/** Mount a filesystem watcher and remount after transient errors. */
export function watchWithRetry(
  mount: () => FSWatcher,
  onError?: (error: unknown) => void,
  retryMs = WATCH_RETRY_MS,
): () => FSWatcher | undefined {
  let watcher: FSWatcher | undefined;

  const attach = () => {
    try {
      watcher?.close();
      watcher = mount();
      watcher.on("error", (error) => {
        onError?.(error);
        setTimeout(attach, retryMs);
      });
    } catch (error) {
      onError?.(error);
      setTimeout(attach, retryMs);
    }
    return watcher;
  };

  attach();
  return () => watcher;
}

export function closeWatcher(watcher: FSWatcher | undefined): void {
  watcher?.close();
}
