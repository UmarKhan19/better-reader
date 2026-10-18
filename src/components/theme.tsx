"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
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
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme, systemDark]);
  return { theme, dark: resolveDark(theme, systemDark), setTheme: writeTheme };
}

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeSelect({
  className,
  onStorageFailure,
}: {
  className?: string;
  onStorageFailure?: (theme: Theme) => void;
}) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-white/5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            const saved = setTheme(value);
            if (!saved) onStorageFailure?.(value);
          }}
          aria-pressed={theme === value}
          aria-label={`Use ${label.toLowerCase()} theme`}
          title={label}
          className={cn(
            "grid h-9 w-9 place-items-center rounded-full transition-colors sm:h-8 sm:w-8",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e50914]",
            theme === value
              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}