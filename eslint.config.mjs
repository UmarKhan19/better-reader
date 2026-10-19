import { isBuiltin } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { plugin as shadcn } from "@shadcn/lint";

const sourceRoot = fileURLToPath(new URL("./src/", import.meta.url));
const modulePath = (file) => file.replace(/\.[cm]?[jt]sx?$/, "");
const within = (file, directory) => file === directory || file.startsWith(`${directory}/`);
const pureModules = new Set([
  "lib/reading-progress",
  "components/reader/reader-preferences",
  "components/reader/navigation/reader-navigation",
  "components/reader/search/reader-search-state",
  "components/reader/chrome/reader-ui-state",
  "components/reader/chrome/reader-thumbnails",
  "components/reader/chrome/reader-scrubber-state",
  ...["geometry", "crop", "tiles", "raster-budget", "render-state", "render-window", "render-scheduler", "text-renderer"]
    .map((name) => `components/reader/viewport/reader-${name}`),
  "components/reader/viewport/reader-limits.json",
]);
const ownershipImports = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      browser: "Keep Node and server modules out of browser/shared code. Use an HTTP route instead.",
      store: "Use the public pdf-store Interface; only the store owns its paths and mutation lock.",
      library: "Library code may use reader-preload, not reader internals.",
      reader: "Reader code must not depend on the library UI.",
      pure: "Keep data, geometry and scheduling independent of React UI and hooks.",
    },
  },
  create(context) {
    const file = relative(sourceRoot, context.filename).split(sep).join("/");
    const browser = within(file, "components") || /^lib\/[^/]+$/.test(file);
    const pure = pureModules.has(modulePath(file));
    function checkImport(node) {
      const source = node.source?.value;
      if (typeof source !== "string") return;
      const resolved = source.startsWith("@/") ? resolve(sourceRoot, source.slice(2))
        : source.startsWith(".") ? resolve(dirname(context.filename), source) : null;
      const target = resolved ? modulePath(relative(sourceRoot, resolved).split(sep).join("/")) : "";
      let messageId;
      if (browser && (source.startsWith("node:") || isBuiltin(source) || within(target, "lib/server"))) {
        messageId = "browser";
      } else if (!within(file, "lib/server/pdf-store") && within(target, "lib/server/pdf-store")
        && target !== "lib/server/pdf-store" && target !== "lib/server/pdf-store/index") {
        messageId = "store";
      } else if (within(file, "components/library") && within(target, "components/reader")
        && target !== "components/reader/reader-preload") {
        messageId = "library";
      } else if (within(file, "components/reader") && within(target, "components/library")) {
        messageId = "reader";
      } else if (pure && (/^(?:react(?:-dom|-pdf)?|next)(?:\/|$)/.test(source)
        || (within(target, "components") && !pureModules.has(target))
        || /(?:^|\/)(?:use-[^/]+|reader-use-zoom)$/.test(target || modulePath(source)))) {
        messageId = "pure";
      }
      if (messageId) context.report({ node: node.source, messageId });
    }
    return {
      ImportDeclaration: checkImport,
      ExportNamedDeclaration: checkImport,
      ExportAllDeclaration: checkImport,
      ImportExpression: checkImport,
    };
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // @shadcn/lint: agent-first Tailwind design-system rules.
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { shadcn },
    rules: {
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
    },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
    // The disposable library fixture resets the store's private cover cache.
    ignores: ["**/*.test.*", "tests/helpers/library.ts"],
    plugins: { ownership: { rules: { imports: ownershipImports } } },
    rules: { "ownership/imports": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/**",
    // Local design-review artifacts, not part of the product (also gitignored).
    ".impeccable/**",
  ]),
]);

export default eslintConfig;
