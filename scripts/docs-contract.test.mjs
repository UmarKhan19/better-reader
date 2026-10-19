import assert from "node:assert/strict"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

async function markdownFilesIn(directory) {
  const entries = await readdir(path.join(repoRoot, directory), {
    recursive: true,
    withFileTypes: true,
  })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

async function contractFiles() {
  const srcAgents = await markdownFilesIn("src")
  return [
    path.join(repoRoot, "AGENTS.md"),
    path.join(repoRoot, "README.md"),
    ...(await markdownFilesIn("docs")),
    ...srcAgents.filter((file) => path.basename(file) === "AGENTS.md"),
  ].sort()
}

async function exists(absolutePath) {
  try {
    await stat(absolutePath)
    return true
  } catch {
    return false
  }
}

function linkTargets(markdown) {
  const withoutFences = markdown.replace(/^```[\s\S]*?^```/gm, "")
  return [...withoutFences.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(
    (match) => match[1].trim(),
  )
}

function isExternal(target) {
  return /^(?:https?:|mailto:)/i.test(target)
}

test("relative markdown links resolve", async () => {
  const failures = []
  for (const file of await contractFiles()) {
    const markdown = await readFile(file, "utf8")
    for (const rawTarget of linkTargets(markdown)) {
      const target = rawTarget.replace(/^<|>$/g, "").split(/\s+/)[0]
      if (!target || target.startsWith("#") || isExternal(target)) continue
      const localPath = target.split(/[?#]/)[0]
      if (!localPath) continue
      const absolutePath = path.resolve(path.dirname(file), localPath)
      if (!(await exists(absolutePath))) {
        failures.push(`${path.relative(repoRoot, file)}: ${rawTarget}`)
      }
    }
  }
  assert.deepEqual(failures, [], "broken relative links")
})

test("documented bun run scripts exist", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  )
  const scripts = packageJson.scripts ?? {}
  const failures = []
  for (const file of await contractFiles()) {
    const markdown = await readFile(file, "utf8")
    for (const match of markdown.matchAll(/\bbun run ([^\s`"'\\]+)/g)) {
      const [command, name] = match
      if (name === "install" || name === "test" || name.startsWith("-")) continue
      if (!Object.hasOwn(scripts, name)) {
        failures.push(`${path.relative(repoRoot, file)}: ${command}`)
      }
    }
  }
  assert.deepEqual(failures, [], "documented scripts missing from package.json")
})

const tablePathExtensions = /\.(?:[cm]?[jt]sx?|json|css|md|toml|ya?ml)$/
const resolutionBases = [
  "",
  "src",
  "src/components",
  "src/components/library",
  "src/components/reader",
  "src/lib/server",
  "src/lib/server/pdf-store",
  "src/lib/server/book-index",
  "src/lib/server/http",
].map((directory) => path.join(repoRoot, directory))

function tablePathTokens(markdown) {
  const rows = markdown
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .filter((line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line))
    .map((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]))

  return rows.flatMap((tokens) =>
    tokens.filter(
      (token) =>
        !/[\s*<>{}→]/.test(token) &&
        token !== "/" &&
        (token.includes("/") || tablePathExtensions.test(token)),
    ),
  )
}

test("architecture table paths resolve", async () => {
  const markdown = await readFile(
    path.join(repoRoot, "docs/architecture.md"),
    "utf8",
  )
  const tokens = tablePathTokens(markdown)
  const bases = new Set(resolutionBases)
  const resolved = new Map()

  // Grow the candidate bases from directory and file tokens in the tables, so
  // owner-table names can resolve relative to their own module directory.
  for (let pass = 0; pass <= tokens.length; pass += 1) {
    let changed = false
    for (const token of tokens) {
      if (resolved.has(token)) continue
      for (const base of bases) {
        const candidate = path.resolve(base, token)
        if (!(await exists(candidate))) continue
        resolved.set(token, candidate)
        const directory = (await stat(candidate)).isDirectory()
          ? candidate
          : path.dirname(candidate)
        if (!bases.has(directory)) {
          bases.add(directory)
          changed = true
        }
        break
      }
    }
    if (!changed) break
  }

  const missing = tokens.filter((token) => !resolved.has(token))
  assert.deepEqual(missing, [], "architecture table paths that do not exist")
})
