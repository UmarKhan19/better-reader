import { markStorageResult } from "./storage-health";

export function storageKey(kind: "settings" | "bookmarks", id: string) {
  return `better-reader:${kind}:${id}`;
}

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Reading remains usable when the browser refuses to save. */
export function writeStorage(key: string, value: unknown): boolean {
  let saved = false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    saved = true;
  } catch {
    // The storage-health store keeps failures separate for each key.
  }
  markStorageResult(key, saved);
  return saved;
}
