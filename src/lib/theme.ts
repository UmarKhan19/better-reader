export type Theme = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "better-reader:theme";

// Keeps the chosen theme usable for this page even when storage refuses the write.
let sessionTheme: Theme | null = null;

export function readTheme(): Theme {
  if (sessionTheme) return sessionTheme;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
  } catch {
    return "system";
  }
}

/** Applies the theme for this page; returns false when it could not be saved for the next visit. */
export function writeTheme(theme: Theme): boolean {
  sessionTheme = theme;
  let saved = true;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The interface still follows the choice for this page when storage is unavailable.
    saved = false;
  }
  emit();
  return saved;
}

export function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveDark(theme: Theme, systemDark: boolean) {
  return theme === "dark" || (theme === "system" && systemDark);
}

export function applyTheme(theme: Theme) {
  const dark = resolveDark(theme, systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  root.dataset.theme = theme;
}

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeSystemTheme(listener: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

/**
 * Runs before the first paint so a saved dark theme never flashes light.
 * Must mirror applyTheme(); see next/dist/docs/…/preventing-flash-before-hydration.md.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t!=="light"&&t!=="dark")t="system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";e.dataset.theme=t}catch(e){}})()`;
