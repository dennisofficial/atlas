import { readFileSync, realpathSync } from 'node:fs'
import { dirname, relative } from 'node:path'

// Bun's native ESM loader has no user hook from a preload, so dependencies are
// traced statically. Dynamic `import()` with a non-literal specifier is not followed.
const SCRIPT = /\.[cm]?[jt]sx?$/
const OPAQUE = /^(node|bun):/
const readFile = readFileSync
const realpath = realpathSync

type Loader = 'ts' | 'tsx' | 'js' | 'jsx'

interface DirectImports {
  imports: string[]
  failure: string | undefined
}

export interface TracedImports {
  files: string[]
  failure: string | undefined
}

const transpilers = new Map<Loader, Bun.Transpiler>()
const directImports = new Map<string, DirectImports>()

export const isScript = (path: string) => SCRIPT.test(path)

export function loaderFor(path: string): Loader {
  if (path.endsWith('.tsx')) return 'tsx'
  if (path.endsWith('.jsx')) return 'jsx'
  return /\.[cm]?ts$/.test(path) ? 'ts' : 'js'
}

function transpilerFor(loader: Loader) {
  let transpiler = transpilers.get(loader)
  if (!transpiler) {
    transpiler = new Bun.Transpiler({ loader })
    transpilers.set(loader, transpiler)
  }
  return transpiler
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

function scanFile(params: { file: string; repoRoot: string }): DirectImports {
  const { file, repoRoot } = params
  try {
    const scanned = transpilerFor(loaderFor(file)).scanImports(readFile(file, 'utf8'))
    const resolved = new Set<string>()
    for (const { path: specifier } of scanned) {
      const target = resolveImport({ specifier, from: file, repoRoot })
      if (target) resolved.add(target)
    }
    return { imports: [...resolved], failure: undefined }
  } catch {
    return {
      imports: [],
      failure: `could not trace imports of ${relative(repoRoot, file)}`,
    }
  }
}

function importsOf(params: { file: string; repoRoot: string }) {
  const known = directImports.get(params.file)
  if (known) return known
  const scanned = scanFile(params)
  directImports.set(params.file, scanned)
  return scanned
}

export function traceImports(params: { entry: string; repoRoot: string }): TracedImports {
  const { entry, repoRoot } = params
  const seen = new Set<string>()
  const stack = [entry]
  let failure: string | undefined
  while (stack.length > 0) {
    const file = stack.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    if (!isScript(file)) continue
    const direct = importsOf({ file, repoRoot })
    failure ??= direct.failure
    stack.push(...direct.imports)
  }
  return { files: [...seen], failure }
}
