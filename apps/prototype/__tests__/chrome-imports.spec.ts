import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const PROTOTYPE_ROOT = resolve(import.meta.dir, '..')
const CHROME_DIRECTORIES = [
  join(PROTOTYPE_ROOT, 'src', 'proto'),
  join(PROTOTYPE_ROOT, 'src', 'app', 'proto'),
]
const SOURCE_FILE = /\.(ts|tsx|mts|js|jsx|mjs)$/
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)['"]([^'"]+)['"]/g
const FORBIDDEN = [/^@dltech\/atlas-ui(\/|$)/, /^@\/features(\/|$)/]

function walk(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function offenders(): string[] {
  return CHROME_DIRECTORIES.flatMap(walk)
    .filter((file) => SOURCE_FILE.test(file))
    .flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)]
        .map((match) => match[1] ?? '')
        .filter((specifier) => FORBIDDEN.some((pattern) => pattern.test(specifier)))
        .map((specifier) => `${relative(PROTOTYPE_ROOT, file)} imports '${specifier}'`),
    )
}

describe('the /proto chrome stays independent of Atlas', () => {
  test('nothing under src/proto or src/app/proto imports @dltech/atlas-ui or @/features', () => {
    const found = offenders()
    expect(found, `chrome must use its own src/proto/ui:\n  - ${found.join('\n  - ')}`).toEqual([])
  })
})
