import { readFileSync, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { init, parse } from 'es-module-lexer'

// Bun's native ESM loader has no user hook from a preload, so dependencies are
// traced statically. Dynamic `import()` with a non-literal specifier and
// `require()` calls are not followed.
const SCRIPT = /\.[cm]?[jt]sx?$/
const OPAQUE = /^(node|bun):/
const readFile = readFileSync
const realpath = realpathSync

type Loader = 'ts' | 'tsx' | 'js' | 'jsx'

const transpilers = new Map<Loader, Bun.Transpiler>()
const directImports = new Map<string, string[]>()
const ready = init

export const initLexer = () => ready

export const isScript = (path: string) => SCRIPT.test(path)

export function loaderFor(path: string): Loader {
  if (path.endsWith('.tsx')) return 'tsx'
  if (path.endsWith('.jsx')) return 'jsx'
  return /\.[cm]?ts$/.test(path) ? 'ts' : 'js'
}

function transpile(code: string, loader: Loader) {
  let transpiler = transpilers.get(loader)
  if (!transpiler) {
    transpiler = new Bun.Transpiler({ loader })
    transpilers.set(loader, transpiler)
  }
  return transpiler.transformSync(code)
}

function isLocal(params: { path: string; repoRoot: string }) {
  const { path, repoRoot } = params
  return path.startsWith(`${repoRoot}/`) && !path.includes('/node_modules/')
}

function resolveImport(params: { specifier: string; from: string; repoRoot: string }) {
  const { specifier, from, repoRoot } = params
  if (OPAQUE.test(specifier)) return undefined
  try {
    const resolved = realpath(Bun.resolveSync(specifier, dirname(from)))
    return isLocal({ path: resolved, repoRoot }) ? resolved : undefined
  } catch {
    return undefined
  }
}

function importsOf(params: { file: string; repoRoot: string }) {
  const { file, repoRoot } = params
  const known = directImports.get(file)
  if (known) return known
  const resolved = new Set<string>()
  try {
    const code = transpile(readFile(file, 'utf8'), loaderFor(file))
    for (const entry of parse(code)[0]) {
      if (entry.n === undefined) continue
      const target = resolveImport({ specifier: entry.n, from: file, repoRoot })
      if (target) resolved.add(target)
    }
  } catch {}
  const result = [...resolved]
  directImports.set(file, result)
  return result
}

export function traceImports(params: { entry: string; repoRoot: string }): string[] {
  const { entry, repoRoot } = params
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    if (isScript(file)) stack.push(...importsOf({ file, repoRoot }))
  }
  return [...seen]
}
