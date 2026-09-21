import { describe, expect, it } from 'vitest'
import { parseStationResult, type StationResultPayload } from './station-result'

const SHA = 'a'.repeat(40)

const validResult = (): StationResultPayload => ({
  branch: 'atlas-factory/add-the-thing',
  base: 'main',
  pushed: true,
  head_sha: SHA,
  change_summary: [{ path: 'src/thing.ts', change: 'added the thing' }],
  verification: [{ command: 'bun test', result: 'pass: 12 tests' }],
  deviations: [],
  known_limitations: ['no coverage of the edge case'],
})

describe('parseStationResult', () => {
  it('accepts the contract the station prompt teaches', () => {
    const parsed = parseStationResult(validResult())
    expect(parsed).toEqual({ ok: true, result: validResult() })
  })

  it('accepts an unpushed result with an empty head sha', () => {
    const parsed = parseStationResult({ ...validResult(), branch: '', pushed: false, head_sha: '' })
    expect(parsed.ok).toBe(true)
  })

  it('refuses a non-object result', () => {
    expect(parseStationResult('nope')).toEqual({ ok: false, error: 'the result must be a JSON object' })
    expect(parseStationResult(null).ok).toBe(false)
    expect(parseStationResult([validResult()]).ok).toBe(false)
  })

  it('refuses a pushed result without a 40-hex head sha', () => {
    const parsed = parseStationResult({ ...validResult(), head_sha: 'abc123' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('head_sha')
  })

  it('refuses a head sha on an unpushed result', () => {
    const parsed = parseStationResult({ ...validResult(), pushed: false, head_sha: SHA })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('pushed is false')
  })

  it('refuses missing or mistyped required fields', () => {
    for (const key of ['branch', 'base', 'pushed', 'head_sha'] as const) {
      const broken: Record<string, unknown> = { ...validResult() }
      delete broken[key]
      expect(parseStationResult(broken).ok, key).toBe(false)
    }
    expect(parseStationResult({ ...validResult(), pushed: 'yes' }).ok).toBe(false)
  })

  it('refuses malformed list entries', () => {
    expect(
      parseStationResult({ ...validResult(), change_summary: [{ path: 'a.ts' }] }).ok,
    ).toBe(false)
    expect(
      parseStationResult({ ...validResult(), verification: [{ command: 'bun test' }] }).ok,
    ).toBe(false)
    expect(parseStationResult({ ...validResult(), deviations: [42] }).ok).toBe(false)
    expect(parseStationResult({ ...validResult(), known_limitations: 'none' }).ok).toBe(false)
  })

  it('refuses bloated payloads instead of storing them', () => {
    const huge = 'x'.repeat(20_001)
    expect(
      parseStationResult({ ...validResult(), known_limitations: [huge] }).ok,
    ).toBe(false)
    const many = Array.from({ length: 201 }, (_, i) => ({ path: `f${i}.ts`, change: 'c' }))
    expect(parseStationResult({ ...validResult(), change_summary: many }).ok).toBe(false)
  })

  it('refuses results over the total payload cap', () => {
    const verification = Array.from({ length: 200 }, (_, i) => ({
      command: `check ${i}`,
      result: 'x'.repeat(600),
    }))
    const parsed = parseStationResult({ ...validResult(), verification })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('cap')
  })
})
