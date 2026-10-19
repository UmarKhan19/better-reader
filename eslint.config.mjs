import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { plugin as shadcn } from "@shadcn/lint";

const restrictImports = (pattern, message) => ({
  selector: `:matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression)[source.value=/${pattern.source}/]`,
  message,
});
const privateStoreImport = restrictImports(
  /(?:^|\/)pdf-store\/(?:storage|index-store|covers|catalog|trash|book-index-files)(?:\.[cm]?[jt]s)?$/,
  "Use the public pdf-store Interface; only the store owns its paths and mutation lock.",
);
const browserImports = [
  privateStoreImport,
  restrictImports(/^(?:node:|@\/lib\/server(?:\/|$)|(?:\.\.?\/)+.*server\/)/,
    "Keep Node and server modules out of browser/shared code. Use an HTTP route instead."),
];

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
    files: ["src/components/**/*.{ts,tsx}", "src/lib/*.{ts,mjs}"],
    ignores: ["**/*.test.*"],
    rules: { "no-restricted-syntax": ["error", ...browserImports] },
  },
  {
    files: ["src/components/library/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: {
      "no-restricted-syntax": ["error", ...browserImports,
        restrictImports(/^(?:@\/components\/reader\/|(?:\.\.?\/)+reader\/)(?!reader-preload(?:\.[^/]*)?$)/,
          "Library code may use reader-preload, not reader internals."),
      ],
    },
  },
  {
    files: [
      "src/lib/reading-progress.ts",
      "src/components/reader/reader-preferences.ts",
      "src/components/reader/navigation/reader-navigation.ts",
      "src/components/reader/search/reader-search-state.ts",
      "src/components/reader/chrome/reader-{thumbnails,scrubber-state}.ts",
      "src/components/reader/viewport/reader-{geometry,crop,tiles,raster-budget,render-state,render-window,render-scheduler,text-renderer}.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...browserImports,
        restrictImports(/^(?:react(?:-dom|-pdf)?(?:\/|$)|next(?:\/|$)|@\/components\/ui\/)|(?:^|\/)(?:use-[^/]+|reader-use-zoom|reader-page-surface|reader-viewport|reader-render-queue|reader-toolbar|reader-sidebar|reader-settings-dialog|reader-controls)(?:\.[jt]sx?)?$/,
          "Keep data, geometry and scheduling independent of React UI and hooks."),
      ],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/lib/server/{book-index,http}/**/*.{ts,mjs}"],
    ignores: ["**/*.test.*"],
    rules: { "no-restricted-syntax": ["error", privateStoreImport] },
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
