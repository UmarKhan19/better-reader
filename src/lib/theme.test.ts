import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { applyTheme, readTheme, writeTheme, themeScript, THEME_STORAGE_KEY, type Theme } from "./theme";

test("a theme choice survives a failing storage write for the current page", () => {
  const globalScope = globalThis as unknown as { window?: unknown };
  const store = new Map<string, string>();
  const local = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  globalScope.window = { localStorage: local };
  try {
    assert.equal(readTheme(), "system");
    assert.equal(writeTheme("dark"), true);
    assert.equal(readTheme(), "dark");
    assert.equal(store.get(THEME_STORAGE_KEY), "dark");
    // Storage refuses the next writes; the choice still applies on this page.
    local.setItem = () => { throw new Error("SecurityError"); };
    assert.equal(writeTheme("light"), false);
    assert.equal(readTheme(), "light");
    assert.equal(store.get(THEME_STORAGE_KEY), "dark");
    assert.equal(writeTheme("system"), false);
    assert.equal(readTheme(), "system");
  } finally {
    delete globalScope.window;
  }
});

function fakeRoot() {
  const classes = new Set<string>();
  return {
    classList: {
      toggle(name: string, force: boolean) { if (force) classes.add(name); else classes.delete(name); },
      contains: (name: string) => classes.has(name),
    },
    style: { colorScheme: "" },
    dataset: {} as { theme?: string },
  };
}

const snapshot = ({ classList, style, dataset }: ReturnType<typeof fakeRoot>) =>
  ({ dark: classList.contains("dark"), colorScheme: style.colorScheme, theme: dataset.theme });

test("the pre-paint themeScript matches applyTheme for every theme and system preference", () => {
  const globalScope = globalThis as unknown as { window?: unknown; document?: unknown };
  try {
    const cases: [Theme, boolean][] = [["light", false], ["dark", false], ["system", false], ["system", true]];
    for (const [theme, systemDark] of cases) {
      const stored = new Map([[THEME_STORAGE_KEY, theme]]);
      const scripted = fakeRoot();
      runInNewContext(themeScript, {
        localStorage: { getItem: (key: string) => stored.get(key) ?? null },
        matchMedia: () => ({ matches: systemDark }),
        document: { documentElement: scripted },
      });

      const applied = fakeRoot();
      globalScope.window = { localStorage: { getItem: () => null }, matchMedia: () => ({ matches: systemDark }) };
      globalScope.document = { documentElement: applied };
      applyTheme(theme);

      assert.deepEqual(snapshot(scripted), snapshot(applied), `${theme} with system dark=${systemDark}`);
    }
  } finally {
    delete globalScope.window;
    delete globalScope.document;
  }
});
