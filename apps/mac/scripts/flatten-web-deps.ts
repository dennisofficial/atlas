import { cpSync, existsSync, lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

const isScoped = (name: string): boolean => name.startsWith('@')

function packagePathsIn(storeDir: string): string[] {
  const paths: string[] = []
  for (const entry of readdirSync(storeDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (!isScoped(entry.name)) {
      paths.push(join(storeDir, entry.name))
      continue
    }
    for (const scoped of readdirSync(join(storeDir, entry.name))) {
      paths.push(join(storeDir, entry.name, scoped))
    }
  }
  return paths
}

export function packageNameOf(realPath: string): string {
  const parent = basename(dirname(realPath))
  return isScoped(parent) ? join(parent, basename(realPath)) : basename(realPath)
}

// Bun's isolated linker leaves a symlink in node_modules and keeps the package's dependencies as its siblings in a store directory. The app bundle copies a symlink as an empty file, so every package the server loads at runtime is flattened into a real directory, dependencies included.
export function flattenPackageLinks({ nodeModules }: { nodeModules: string }): string[] {
  const queued: string[] = []
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue
    const link = join(nodeModules, entry.name)
    queued.push(realpathSync(link))
    rmSync(link, { force: true })
  }
  const seen = new Set<string>()
  const written: string[] = []
  while (queued.length > 0) {
    const real = queued.shift() as string
    if (seen.has(real)) continue
    seen.add(real)
    const destination = join(nodeModules, packageNameOf(real))
    if (!existsSync(destination)) {
      cpSync(real, destination, { recursive: true, dereference: true })
      written.push(relative(nodeModules, destination))
    }
    for (const sibling of packagePathsIn(dirname(real))) {
      const resolved = realpathSync(sibling)
      if (resolved !== real) queued.push(resolved)
    }
  }
  return written
}

export function nodeModulesDirsUnder(root: string): string[] {
  const found: string[] = []
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules') {
        found.push(join(at, entry.name))
        continue
      }
      if (entry.name === '.bun') continue
      walk(join(at, entry.name))
    }
  }
  walk(root)
  return found
}

export function symlinksUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const found: string[] = []
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isSymbolicLink()) found.push(path)
      else if (entry.isDirectory()) walk(path)
    }
  }
  walk(dir)
  return found
}

if (import.meta.main) {
  const root = process.argv[2]
  if (root === undefined) throw new Error('usage: flatten-web-deps.ts <web-standalone>')
  const written = nodeModulesDirsUnder(root).flatMap((nodeModules) =>
    flattenPackageLinks({ nodeModules }),
  )
  const store = join(root, 'node_modules')
  if (existsSync(store) && readdirSync(store).every((name) => name.startsWith('.')))
    rmSync(store, { recursive: true, force: true })
  const links = symlinksUnder(root)
  if (links.length > 0) throw new Error(`the bundle still links out: ${links.join(', ')}`)
  console.log(`flattened ${written.length} packages: ${written.join(' ')}`)
}
