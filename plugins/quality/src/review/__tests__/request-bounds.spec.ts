import { describe, expect, it } from 'bun:test'

import type { QualityScope } from '@dltech/atlas-core'

import { singleResponsibilityPolicy } from '../../policies'

import {
  MAX_STATE_AND_ALL_QUESTIONS_BYTES,
  MAX_STATE_AND_LONGEST_QUESTION_BYTES,
  planRequests,
} from '../review-scopes'
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
})
