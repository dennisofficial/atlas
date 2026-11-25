import { describe, expect, it } from 'bun:test'

import { EQualitySkipReason, type QualityScope } from '@dltech/atlas-core'

import { singleResponsibilityPolicy } from '../../policies'

import {
  CONSERVATIVE_BYTES_PER_TOKEN,
  JEV_QUESTION_TOKENS,
  JEV_REQUEST_TOKENS,
  MAX_STATE_AND_ALL_QUESTIONS_BYTES,
  MAX_STATE_AND_LONGEST_QUESTION_BYTES,
  planRequests,
} from '../review-scopes'
import { prepareQualityRequest } from '../request'
import { prepareQualityScopes } from '../source'

const PROJECT = '/repo'

function longFunction(lines: number): string {
  const body = Array.from(
    { length: lines - 2 },
    (_, index) => `  const value${index} = ${index} + source${index % 7}`,
  )
  return [
    'export function accumulate(source0: number, source1: number, source2: number, source3: number, source4: number, source5: number, source6: number): number {',
    ...body,
    '  return value0',
    '}',
  ].join('\n')
}

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

describe('request bounds', () => {
  it('keeps a 200-line function under the size bounds in one unit', () => {
    const after = `${longFunction(200)}\n`
    const preparation = prepareQualityScopes({
      change: { path: `${PROJECT}/src/long.ts`, before: null, after },
      projectDirectory: PROJECT,
      workspaceNamespace: 'ns',
      previousScopes: [],
    })
    const scope = preparation.scopes.find((candidate) => candidate.name === 'accumulate')
    expect(scope).toBeDefined()

    const plan = planRequests({
      scope: scope as QualityScope,
      policies: [singleResponsibilityPolicy],
    })
    expect(plan.rejected).toHaveLength(0)
    expect(plan.units).toHaveLength(1)

    const unit = plan.units[0]
    if (unit === undefined) throw new Error('expected one unit')
    const state = byteLength(unit.request.state)
    const sizes = Object.values(unit.request.questions).map((question) =>
      byteLength(JSON.stringify(question)),
    )
    const longest = sizes.reduce((max, size) => Math.max(max, size), 0)
    const total = sizes.reduce((sum, size) => sum + size, 0)

    expect(state + longest).toBeLessThanOrEqual(MAX_STATE_AND_LONGEST_QUESTION_BYTES)
    expect(state + total).toBeLessThanOrEqual(MAX_STATE_AND_ALL_QUESTIONS_BYTES)
  })

  it('derives the byte bounds from the classifier token limits', () => {
    expect(MAX_STATE_AND_LONGEST_QUESTION_BYTES).toBe(
      Math.floor(JEV_QUESTION_TOKENS * 0.95 * CONSERVATIVE_BYTES_PER_TOKEN),
    )
    expect(MAX_STATE_AND_ALL_QUESTIONS_BYTES).toBe(
      Math.floor(JEV_REQUEST_TOKENS * 0.95 * CONSERVATIVE_BYTES_PER_TOKEN),
    )
  })
})

function classText(args: { rows: number; marker: string; lineLength?: number }): string {
  const filler = 'x'.repeat(args.lineLength ?? 0)
  const changed = Math.floor(args.rows / 2)
  const body = Array.from({ length: args.rows }, (_, index) =>
    index === changed
      ? `    this.total += this.load(${index}) // ${args.marker} ${filler}`
      : `    this.total += this.load(${index})`,
  )
  return [
    'export class Ledger {',
    '  private total = 0',
    '',
    '  reconcile(): number {',
    '    this.total = 0',
    ...body,
    '    return this.total',
    '  }',
    '',
    '  load(seed: number): number {',
    '    return seed * 2',
    '  }',
    '}',
    '',
  ].join('\n')
}

function ledgerScope(args: { before: string; after: string }): QualityScope {
  const preparation = prepareQualityScopes({
    change: { path: `${PROJECT}/src/ledger.ts`, before: args.before, after: args.after },
    projectDirectory: PROJECT,
    workspaceNamespace: 'ns',
    previousScopes: [],
  })
  const scope = preparation.scopes.find((candidate) => candidate.name === 'Ledger')
  if (scope === undefined) throw new Error('expected the Ledger class scope')
  return scope
}

describe('oversized scopes', () => {
  it('leaves a scope that already fits byte-identical', () => {
    const after = `${longFunction(200)}\n`
    const preparation = prepareQualityScopes({
      change: { path: `${PROJECT}/src/long.ts`, before: null, after },
      projectDirectory: PROJECT,
      workspaceNamespace: 'ns',
      previousScopes: [],
    })
    const scope = preparation.scopes.find((candidate) => candidate.name === 'accumulate')
    if (scope === undefined) throw new Error('expected the accumulate scope')

    const planned = planRequests({ scope, policies: [singleResponsibilityPolicy] })
    const direct = prepareQualityRequest({ scope, policies: [singleResponsibilityPolicy] })

    expect(planned.units[0]?.request.state).toBe(direct.state)
    expect(planned.units[0]?.request.questions).toEqual(direct.questions)
    expect(direct.state).not.toContain('"excerpt"')
  })

  it('sends a 900-line class whole, under the per-question limit', () => {
    const before = classText({ rows: 900, marker: 'old' })
    const after = classText({ rows: 900, marker: 'new' })

    const scope = ledgerScope({ before, after })
    const plan = planRequests({ scope, policies: [singleResponsibilityPolicy] })

    expect(plan.rejected).toHaveLength(0)
    expect(plan.units).toHaveLength(1)
    const unit = plan.units[0]
    if (unit === undefined) throw new Error('expected one unit')
    expect(unit.request.state).not.toContain('"excerpt"')
    expect(byteLength(unit.request.state)).toBeLessThanOrEqual(MAX_STATE_AND_LONGEST_QUESTION_BYTES)
  })

  it('reviews a 3,000-line class as an excerpt inside the per-question limit', () => {
    const before = classText({ rows: 3000, marker: 'old' })
    const after = classText({ rows: 3000, marker: 'new' })
    const scope = ledgerScope({ before, after })

    const full = prepareQualityRequest({ scope, policies: [singleResponsibilityPolicy] })
    expect(byteLength(full.state)).toBeGreaterThan(MAX_STATE_AND_LONGEST_QUESTION_BYTES)

    const plan = planRequests({ scope, policies: [singleResponsibilityPolicy] })

    expect(plan.rejected).toHaveLength(0)
    const unit = plan.units[0]
    if (unit === undefined) throw new Error('expected one unit')
    expect(unit.request.state).toContain('"excerpt":{"reason":"oversized"')
    expect(unit.request.state).toContain('Ledger.load')
    expect(byteLength(unit.request.state)).toBeLessThanOrEqual(MAX_STATE_AND_LONGEST_QUESTION_BYTES)
  })

  it('still skips a pathological 900 KB scope with the same reason', () => {
    const before = classText({ rows: 1, marker: 'old', lineLength: 900 * 1024 })
    const after = classText({ rows: 1, marker: 'new', lineLength: 900 * 1024 })
    const scope = ledgerScope({ before, after })

    const plan = planRequests({ scope, policies: [singleResponsibilityPolicy] })

    expect(plan.units).toHaveLength(0)
    expect(plan.rejected[0]).toMatchObject({
      reason: EQualitySkipReason.OversizedRequest,
    })
  })
})
