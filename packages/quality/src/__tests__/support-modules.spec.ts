import { describe, expect, it } from 'bun:test'

import {
  EQualityReviewStatus,
  type CodeQualityReviewedBody,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'

import { qualityReviewsOf } from '../quality-reviews'
import { qualitySwitches } from '../settings'
import { call, stampHistory } from './fixtures'

describe('qualitySwitches', () => {
  it('defaults every switch to false', () => {
    expect(qualitySwitches({ values: {} })).toEqual({ enabled: false, policyFlags: {} })
  })

  it('reads the master switch and boolean policy flags only', () => {
    const switches = qualitySwitches({
      values: {
        'quality.enabled': true,
        'quality.policies.a': false,
        other: 'text',
      },
    })
    expect(switches.enabled).toBe(true)
    expect(switches.policyFlags['quality.policies.a']).toBe(false)
    expect('other' in switches.policyFlags).toBe(false)
  })
})

describe('qualityReviewsOf', () => {
  const record = (status: EQualityReviewStatus): EventDraft => ({
    type: 'code-quality-reviewed',
    callId: call.callId,
    workspaceNamespace: 'ns',
    path: 'src/a.ts',
    beforeHash: null,
    afterHash: 'a1',
    status,
    assessments: [],
    findings: [],
    durationMs: 1,
  })

  it('reads a standalone record as itself', () => {
    const [event] = stampHistory({ batches: [[record(EQualityReviewStatus.Completed)]] })
    expect(event === undefined ? [] : qualityReviewsOf(event)).toHaveLength(1)
  })

  it('reads the reviews carried on a tool result', () => {
    const [standalone] = stampHistory({ batches: [[record(EQualityReviewStatus.Completed)]] })
    if (standalone === undefined) throw new Error('fixture')
    const body = standalone as CodeQualityReviewedBody
    const event = {
      ...standalone,
      type: 'tool-result',
      qualityReviews: [body],
    } as unknown as Event
    expect(qualityReviewsOf(event)).toHaveLength(1)
  })

  it('reads nothing from an unrelated event', () => {
    const [standalone] = stampHistory({ batches: [[record(EQualityReviewStatus.Completed)]] })
    if (standalone === undefined) throw new Error('fixture')
    const event = { ...standalone, type: 'nudge', text: 'x', lifetimeSteps: 1 } as Event
    expect(qualityReviewsOf(event)).toHaveLength(0)
  })
})
