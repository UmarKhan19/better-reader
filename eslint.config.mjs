import { isBuiltin } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { plugin as shadcn } from "@shadcn/lint";
import { pureModules } from "./scripts/lib/import-policy.mjs";

const sourceRoot = fileURLToPath(new URL("./src/", import.meta.url));
const projectRoot = fileURLToPath(new URL("./", import.meta.url));
const modulePath = (file) => file.replace(/\.[cm]?[jt]sx?$/, "");
const within = (file, directory) => file === directory || file.startsWith(`${directory}/`);
const pureModuleSet = new Set(pureModules);
// Geometry exceptions apply to native elements, never shared control props.
const runtimeStyles = (allow) => ["error", { allow, contracts: [{ pattern: "^[A-Z]", allow: [] }] }];
const ownershipImports = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      browser: "Keep Node and server modules out of browser/shared code. Use an HTTP route instead.",
      store: "Use the public pdf-store Interface; only the store owns its paths and mutation lock.",
      http: "Use the http module's root exports; only the module owns its subpaths.",
      bookIndex: "Use the book-index root exports; only the module owns its subpaths.",
      library: "Library code may use reader-preload, not reader internals.",
      reader: "Reader code must not depend on the library UI.",
      pure: "Keep data, geometry and scheduling independent of React UI and hooks.",
    },
  },
  create(context) {
    const file = relative(sourceRoot, context.filename).split(sep).join("/");
    const fileFromRoot = relative(projectRoot, context.filename).split(sep).join("/");
    const browser = within(file, "components") || /^lib\/[^/]+$/.test(file);
    const pure = pureModuleSet.has(modulePath(file));
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
      } else if (!within(file, "lib/server/http") && within(target, "lib/server/http")
        && target !== "lib/server/http" && target !== "lib/server/http/index") {
        messageId = "http";
      } else if (!within(file, "lib/server/book-index") && within(target, "lib/server/book-index")
        && target !== "lib/server/book-index" && target !== "lib/server/book-index/index"
        && !within(fileFromRoot, "tests") && !within(fileFromRoot, "scripts")) {
        messageId = "bookIndex";
      } else if (within(file, "components/library") && within(target, "components/reader")
        && target !== "components/reader/reader-preload") {
        messageId = "library";
      } else if (within(file, "components/reader") && within(target, "components/library")) {
        messageId = "reader";
      } else if (pure && (/^(?:react(?:-dom|-pdf)?|next)(?:\/|$)/.test(source)
        || (within(target, "components") && !pureModuleSet.has(target))
        || /(?:^|\/)use-[^/]+$/.test(target || modulePath(source)))) {
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
    settings: { shadcn: { note: "See DESIGN.md for token ownership, shared controls and runtime geometry exceptions." } },
    rules: {
      "shadcn/no-restyle": ["error", {
        allow: ["layout"],
        contracts: [{
          pattern: "^Button$",
          allow: ["w-full", "m-*", "mx-*", "my-*", "ms-*", "me-*", "mt-*", "mr-*", "mb-*", "ml-*", "display", "self-*", "order-*", "col-*", "row-*"],
        }],
      }],
      "shadcn/require-static-classes": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
    },
  },
  // Runtime geometry stays inline, but only these properties in their owning files.
  {
    files: ["src/components/library/library-{card,hero}.tsx"],
    rules: { "shadcn/no-inline-styles": runtimeStyles(["width"]) },
  },
  {
    files: ["src/components/reader/pdf-reader.tsx", "src/components/library/library-grid.tsx"],
    rules: { "shadcn/no-inline-styles": runtimeStyles(["transform"]) },
  },
  {
    files: ["src/components/reader/chrome/reader-scrubber.tsx"],
    rules: { "shadcn/no-inline-styles": runtimeStyles(["transform", "insetInlineStart"]) },
  },
  {
    files: ["src/components/reader/chrome/reader-sidebar.tsx"],
    rules: { "shadcn/no-inline-styles": runtimeStyles(["paddingInlineStart"]) },
  },
  {
    files: ["src/components/reader/chrome/reader-thumbnail-list.tsx"],
    rules: { "shadcn/no-inline-styles": runtimeStyles(["height", "top"]) },
  },
  {
    files: ["src/components/reader/viewport/reader-page-surface.tsx"],
    rules: { "shadcn/no-inline-styles": runtimeStyles(["left", "top", "width", "height", "maxWidth", "maxHeight", "zIndex", "pointerEvents", "visibility", "transform"]) },
  },
  {
    files: ["src/components/reader/viewport/reader-tile.tsx"],
    rules: { "shadcn/no-inline-styles": runtimeStyles(["left", "top", "width", "height", "visibility"]) },
  },
  {
    files: ["src/components/reader/viewport/reader-viewport.tsx"],
    rules: { "shadcn/no-inline-styles": runtimeStyles(["width", "height"]) },
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
