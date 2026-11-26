import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import * as protocol from '@dltech/atlas-protocol'
import * as wire from '@dltech/atlas-wire'

const GENERATED = join(import.meta.dirname, '..', 'generated', 'server.ts')
const ALLOWED = new Set(['@trpc/server', 'zod', '@dltech/atlas-wire', '@dltech/atlas-protocol'])
const SUBSCRIPTION_OUTPUT = /\.output\((\w+)\)\s*\.subscription\(/g

type Parser = { safeParse(value: unknown): { success: boolean } }

const isParser = (value: unknown): value is Parser =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'safeParse') === 'function'

const schemaNamed = (name: string): Parser => {
  const found: unknown = Reflect.get(protocol, name) ?? Reflect.get(wire, name)
  if (!isParser(found)) throw new Error(`no schema named ${name}`)
  return found
}

const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

describe('generated AppRouter', () => {
  it('imports only @trpc/server, zod, @dltech/atlas-wire and @dltech/atlas-protocol', () => {
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

  it('validates every subscription output as a stream, because trpc parses the generator', () => {
    const source = readFileSync(GENERATED, 'utf8')
    const names = [...source.matchAll(SUBSCRIPTION_OUTPUT)].map((match) => match[1] ?? '')
    const stream = async function* (): AsyncGenerator<never> {}
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => !schemaNamed(name).safeParse(stream()).success)).toEqual([])
  })
})
