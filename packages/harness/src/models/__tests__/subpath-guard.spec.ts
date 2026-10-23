import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { subpathViolations } from './subpath-walker'

const MODELS_ENTRY = join(import.meta.dir, '..', 'index.ts')
const ALLOWED = ['@dltech/atlas-core', '@dltech/atlas-models', 'zod']

let scratch: string | undefined

afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
})

const fixture = (files: Record<string, string>): string => {
  scratch = mkdtempSync(join(tmpdir(), 'atlas-subpath-guard-'))
  const root = join(scratch, 'models')
  mkdirSync(root)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text)
  writeFileSync(join(scratch, 'outside.ts'), 'export const x = 1\n')
  return join(root, 'index.ts')
}

describe('subpath guard', () => {
  it('finds nothing forbidden reachable from @dltech/atlas-harness/models', () => {
    expect(subpathViolations({ entry: MODELS_ENTRY, allowedPackages: ALLOWED })).toEqual([])
  })

  it('reports node:, bare packages outside the allowlist, escapes and runtime globals', () => {
    const entry = fixture({
      'index.ts': [
        "import { readFileSync } from 'node:fs'",
        "import { generateText } from 'ai'",
        "export * from './inner'",
        "export * from '../outside'",
        'export const where = process.cwd()',
        '',
      ].join('\n'),
      'inner.ts': "export const t = Bun.nanoseconds()\nexport { z } from 'zod'\n",
    })

    const found = subpathViolations({ entry, allowedPackages: ALLOWED }).map(
      (violation) => violation.reason,
    )

    expect(found).toEqual(
      expect.arrayContaining([
        'imports node:fs',
        'imports ai',
        'imports outside src/models: ../outside',
        'uses process.',
        'uses Bun.',
      ]),
    )
    expect(found.some((reason) => reason.includes('zod'))).toBe(false)
  })
})
