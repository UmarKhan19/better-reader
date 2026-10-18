import { useCallback, useState } from "react";
import type { LibraryNotice } from "./library-model";

export function useNotice() {
  const [notice, setNotice] = useState<LibraryNotice | null>(null);

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  const warnThemeStorage = useCallback((theme: string) => {
    setNotice({ tone: "warning", text: `Theme set to ${theme} for this page. This browser isn't saving the choice.` });
  }, []);

  return { notice, setNotice, dismissNotice, warnThemeStorage };
}
