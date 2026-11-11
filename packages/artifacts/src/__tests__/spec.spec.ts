import { describe, expect, it } from 'bun:test'

import { ArtifactSpecError, parseSpec, specHash } from '../spec'

const buildOf = (build: Record<string, unknown>) => ({
  build: { cmd: 'bun run build', outDir: 'dist', ...build },
})

describe('parseSpec', () => {
  it('applies every default', () => {
    expect(parseSpec({})).toEqual({
      serve: { spa: false },
      publish: { include: [], exclude: [] },
    })
  })

  it('applies defaults inside the build block', () => {
    expect(parseSpec(buildOf({}))).toEqual({
      build: { runtime: 'node22', cmd: 'bun run build', outDir: 'dist', timeoutSec: 300 },
      serve: { spa: false },
      publish: { include: [], exclude: [] },
    })
  })

  it('accepts a nested outDir and a notFound page', () => {
    const spec = parseSpec({
      ...buildOf({ outDir: 'packages/site/dist' }),
      serve: { spa: true, notFound: '404.html' },
    })
    expect(spec.build?.outDir).toBe('packages/site/dist')
    expect(spec.serve.notFound).toBe('404.html')
  })

  it.each([
    { name: 'an absolute outDir', raw: buildOf({ outDir: '/dist' }) },
    { name: 'an escaping outDir', raw: buildOf({ outDir: '../dist' }) },
    { name: 'a dot outDir', raw: buildOf({ outDir: '.' }) },
    { name: 'an empty outDir', raw: buildOf({ outDir: '' }) },
    { name: 'a missing cmd', raw: { build: { outDir: 'dist' } } },
    { name: 'an unknown runtime', raw: buildOf({ runtime: 'node20' }) },
    { name: 'a short timeout', raw: buildOf({ timeoutSec: 9 }) },
    { name: 'a long timeout', raw: buildOf({ timeoutSec: 901 }) },
    { name: 'a fractional timeout', raw: buildOf({ timeoutSec: 30.5 }) },
    { name: 'an escaping notFound', raw: { serve: { notFound: '../index.html' } } },
    { name: 'an absolute notFound', raw: { serve: { notFound: '/index.html' } } },
    { name: 'a non-array include', raw: { publish: { include: 'src' } } },
  ])('rejects $name', ({ raw }) => {
    expect(() => parseSpec(raw)).toThrow(ArtifactSpecError)
  })
})

describe('specHash', () => {
  it('is stable across key order', () => {
    const left = parseSpec({
      build: { cmd: 'bun run build', outDir: 'dist' },
      serve: { spa: true },
    })
    const right = parseSpec({
      serve: { spa: true },
      build: { outDir: 'dist', cmd: 'bun run build' },
    })
    expect(specHash(left)).toBe(specHash(right))
  })

  it('is stable across unset versus default', () => {
    const implicit = parseSpec({ build: { cmd: 'bun run build', outDir: 'dist' } })
    const explicit = parseSpec({
      build: { runtime: 'node22', cmd: 'bun run build', outDir: 'dist', timeoutSec: 300 },
      serve: { spa: false },
      publish: { include: [], exclude: [] },
    })
    expect(specHash(implicit)).toBe(specHash(explicit))
  })

  it('changes when the served rules change', () => {
    const plain = parseSpec({ serve: { spa: false } })
    const spa = parseSpec({ serve: { spa: true } })
    expect(specHash(plain)).not.toBe(specHash(spa))
  })

  it('produces a sha256 hex digest', () => {
    expect(specHash(parseSpec({}))).toMatch(/^[0-9a-f]{64}$/)
  })
})
