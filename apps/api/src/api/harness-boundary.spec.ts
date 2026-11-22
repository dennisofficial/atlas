import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'

const SRC_ROOT = path.dirname(import.meta.dirname)
const SPECIFIER_PATTERN = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

function listTsFiles({ dir }: { dir: string }): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listTsFiles({ dir: full })
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

function harnessSpecifiers({ file }: { file: string }): string[] {
  return [...readFileSync(file, 'utf8').matchAll(SPECIFIER_PATTERN)].flatMap((match) =>
    match[1]?.startsWith('@dltech/atlas-harness') ? [match[1]] : [],
  )
}

describe('harness boundary', () => {
  it('never imports @dltech/atlas-harness', () => {
    const offenders = listTsFiles({ dir: SRC_ROOT }).flatMap((file) =>
      harnessSpecifiers({ file }).map(
        (specifier) => `${path.relative(SRC_ROOT, file)} -> ${specifier}`,
      ),
    )
    expect(offenders).toEqual([])
  })
})
