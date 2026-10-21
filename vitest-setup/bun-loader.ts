import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import type { Plugin } from 'vite'

const FILE_IMPORT = /import\(\s*(["'])([^"']+)\1(?:\s+as\s+string)?\s*,\s*\{\s*with:\s*\{\s*type:\s*(["'])file\3\s*\}\s*\}\s*\)/g

// Bun's `import(path, { with: { type: 'file' } })` resolves to the file's path; Vite's module
// runner would load the asset as a module instead. https://bun.sh/docs/bundler/loaders#file
export function bunFileImports(): Plugin {
  return {
    name: 'atlas:bun-file-imports',
    enforce: 'pre',
    transform(code, id) {
      if (!code.includes("type: 'file'") && !code.includes('type: "file"')) return null
      const from = dirname(id.split('?')[0] ?? id)
      const out = code.replace(FILE_IMPORT, (_match, _quote, specifier: string) =>
        `Promise.resolve({ default: ${JSON.stringify(resolve(from, specifier))} })`,
      )
      return out === code ? null : { code: out, map: null }
    },
  }
}

const BUN_BUILTIN_PREFIX = '\0atlas-bun-builtin:'

const BUN_BUILTIN_SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(bun:[a-z]+)\2/g

// `bun:*` builtins exist only in Bun's own loader. Vitest's module runner treats anything
// `isBuiltin` accepts as a Node builtin and prefixes `node:`, so each one is re-exported through a
// virtual module that requires it at runtime.
export function bunBuiltins(): Plugin {
  const require = createRequire(import.meta.url)
  return {
    name: 'atlas:bun-builtins',
    enforce: 'pre',
    transform(code, id) {
      if (!code.includes('bun:') || id.startsWith(BUN_BUILTIN_PREFIX)) return null
      const out = code.replace(BUN_BUILTIN_SPECIFIER, (_match, lead: string, quote: string, specifier: string) => `${lead}${quote}atlas-bun-builtin:${specifier}${quote}`)
      return out === code ? null : { code: out, map: null }
    },
    resolveId(id) {
      return id.startsWith('atlas-bun-builtin:') ? `${BUN_BUILTIN_PREFIX}${id.slice('atlas-bun-builtin:'.length)}` : null
    },
    load(id) {
      if (!id.startsWith(BUN_BUILTIN_PREFIX)) return null
      const specifier = id.slice(BUN_BUILTIN_PREFIX.length)
      const names = Object.keys(require(specifier)).filter((name) => name !== 'default')
      const exports = names.map((name) => `export const ${name} = builtin[${JSON.stringify(name)}]`)
      return [
        `import { createRequire } from 'node:module'`,
        `const builtin = createRequire(import.meta.url)(${JSON.stringify(specifier)})`,
        'export default builtin',
        ...exports,
      ].join('\n')
    },
  }
}

const escape = (path: string) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Repo plugins import the `atlas` module that `Bun.plugin`'s build.module registers at runtime.
// Only Bun's own loader honours that, so modules staged in the temp dir are left to it.
export function tempDirExternals(): RegExp[] {
  const roots = new Set([tmpdir(), realpathSync(tmpdir())])
  return [...roots].map((root) => new RegExp(`^${escape(root)}`))
}

const BUN_CONDITION_PACKAGE = /^@opentui\/core(?:\/|$)/

// @opentui/core ships separate `bun` and `node` builds. Externalised dependencies are loaded by Bun's
// own resolver (`bun` condition) while Vite resolves with `node`, which would give a spec and
// @opentui/react two copies of core whose classes fail `instanceof`.
export function bunConditionPackages(): Plugin {
  return {
    name: 'atlas:bun-condition-packages',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!BUN_CONDITION_PACKAGE.test(id) || importer === undefined) return null
      return createRequire(importer.split('?')[0] ?? importer).resolve(id)
    },
  }
}
