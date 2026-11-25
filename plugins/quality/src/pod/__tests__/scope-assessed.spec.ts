import { describe, expect, it } from 'bun:test'

import { EAnalyticsLinks } from '@dltech/atlas-plugin-sdk'

import { analyticsRecorder, completedOf, createRig, scopesOf } from './support'

describe('the scope assessed event', () => {
  it('sends one event for the single scope and policy the review scored', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run()

    const scopes = scopesOf(captured)
    expect(scopes).toHaveLength(1)
    const reviewId = String(completedOf(captured)?.properties.review_id)
    expect(scopes[0]?.properties).toMatchObject({
      review_id: reviewId,
      policy_id: 'single-responsibility',
      policy_version: '1',
      change_kind: 'edited',
      concern_score: 0.9,
      impact: 'introduced',
      impact_confidence: 0.9,
      transition: 'introduce',
      verdict: 'nudged',
      near_miss: false,
      concern_threshold: 0.8,
      impact_threshold: 0.8,
      deadline_missed: false,
    })
    expect(scopes[0]?.properties.extension).toBe('.ts')
    expect(Number(scopes[0]?.properties.scope_bytes)).toBeGreaterThan(0)
    expect(Number(scopes[0]?.properties.request_bytes)).toBeGreaterThan(0)
    expect(scopes[0]?.links).toBe(EAnalyticsLinks.Hashed)
  })

  it('sends no scope event for a scope the engine did not score', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run({ projectDirectory: '/elsewhere' })

    expect(scopesOf(captured)).toEqual([])
  })
})
