// Storage health is an external store: every write records whether the browser kept
// the value, keyed by that value's own key. A successful write of one key never
// hides the failure of another.
const failedStorageKeys = new Set<string>();
let storageBlocked = false;
const storageBlockedListeners = new Set<() => void>();

export function storageBlockedSnapshot() {
  return storageBlocked;
}

export function subscribeStorageBlocked(listener: () => void) {
  storageBlockedListeners.add(listener);
  return () => {
    storageBlockedListeners.delete(listener);
  };
}

export function markStorageResult(key: string, saved: boolean) {
  if (saved) failedStorageKeys.delete(key);
  else failedStorageKeys.add(key);
  const blocked = failedStorageKeys.size > 0;
  if (storageBlocked === blocked) return;
  storageBlocked = blocked;
  for (const listener of storageBlockedListeners) listener();
}

/**
 * Called when the user explicitly retries saving. Stale failures from another book
 * must not outlive a successful retry; any write that still fails adds its key back.
 */
export function clearStorageFailures() {
  failedStorageKeys.clear();
  if (!storageBlocked) return;
  storageBlocked = false;
  for (const listener of storageBlockedListeners) listener();
}
