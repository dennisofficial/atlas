import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

const GENERATED = join(import.meta.dirname, '..', 'generated', 'server.ts')
const ALLOWED = new Set(['@trpc/server', 'zod', '@dltech/atlas-wire'])
const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

describe('generated AppRouter', () => {
  it('imports only @trpc/server, zod and @dltech/atlas-wire', () => {
    const specifiers = [...readFileSync(GENERATED, 'utf8').matchAll(SPECIFIER)].map(
      (match) => match[1] ?? '',
    )
    expect(specifiers.length).toBeGreaterThan(0)
    expect(specifiers.filter((specifier) => !ALLOWED.has(specifier))).toEqual([])
  })

  it('declares every procedure with an output so no api source is imported', () => {
    const source = readFileSync(GENERATED, 'utf8')
    const procedures = source.match(/\.(?:mutation|query|subscription)\(/g) ?? []
    const outputs = source.match(/\.output\(/g) ?? []
    expect(procedures.length).toBeGreaterThan(0)
    expect(outputs).toHaveLength(procedures.length)
  })
})
