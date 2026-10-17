"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { SunMoon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  applyTheme, readTheme, resolveDark, subscribeSystemTheme, subscribeTheme, systemPrefersDark,
  writeTheme, type Theme,
} from "@/lib/theme";

export { THEME_STORAGE_KEY, readTheme, writeTheme, type Theme } from "@/lib/theme";

/** Reads the app-wide theme and keeps <html> in sync with it. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as Theme);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, systemPrefersDark, () => false);
  // Re-applies after React clears the <html> attributes on the development remount.
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme, systemDark]);
  return { theme, dark: resolveDark(theme, systemDark), setTheme: writeTheme };
}

export function ThemeSelect({
  className,
  onStorageFailure,
}: {
  className?: string;
  onStorageFailure?: (theme: Theme) => void;
}) {
  const { theme, setTheme } = useTheme();
  return (
    <label className={cn("flex items-center gap-2 text-zinc-500 dark:text-zinc-400", className)}>
      <SunMoon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">Interface theme</span>
      <select
        value={theme}
        onChange={(event) => {
          const saved = setTheme(event.target.value as Theme);
          if (!saved) onStorageFailure?.(event.target.value as Theme);
        }}
        className="h-11 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
