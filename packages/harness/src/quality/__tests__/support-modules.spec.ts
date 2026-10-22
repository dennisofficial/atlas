import { describe, expect, it } from 'bun:test'

import { ESettingKind, ESettingPage, EQualityHealthStatus, type Event } from '@dltech/atlas-core'

import { buildAssessmentCacheKey, createQualityAssessmentCache } from '../evaluation-cache'
import { readQualityHealth } from '../health'
import { buildRecord } from '../review-records'
import { qualitySettingDefinitions, qualitySwitches } from '../settings'
import { EQualityReviewStatus, prepareQualityRequest } from '@dltech/atlas-core'
import { THREAD, call, policyNamed, scopeNamed, stampHistory } from './fixtures'

describe('qualitySettingDefinitions', () => {
  it('maps each descriptor to a toggle row keyed by its settingKey', () => {
    const rows = qualitySettingDefinitions({ policies: [policyNamed({ id: 'a' }), { ...policyNamed({ id: 'b' }), defaultEnabled: false }] })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      id: 'quality.policies.a',
      page: ESettingPage.CodeQuality,
      kind: ESettingKind.Toggle,
      label: 'Policy a',
      description: 'a test policy',
      fallback: true,
    })
    expect(rows[1]).toMatchObject({ id: 'quality.policies.b', fallback: false })
  })

  it('emits no master or recordExamples rows', () => {
    expect(qualitySettingDefinitions({ policies: [] })).toEqual([])
  })
})

describe('qualitySwitches', () => {
  it('defaults every switch to false', () => {
    expect(qualitySwitches({ values: {} })).toEqual({ enabled: false, recordExamples: false, policyFlags: {} })
  })

  it('reads master, collection and boolean policy flags only', () => {
    const switches = qualitySwitches({
      values: { 'quality.enabled': true, 'quality.recordExamples': true, 'quality.policies.a': false, other: 'text' },
    })
    expect(switches.enabled).toBe(true)
    expect(switches.recordExamples).toBe(true)
    expect(switches.policyFlags['quality.policies.a']).toBe(false)
    expect('other' in switches.policyFlags).toBe(false)
  })
})

describe('assessment cache', () => {
  const policy = policyNamed()
  const scope = scopeNamed()
  const request = prepareQualityRequest({ scope, policies: [policy] })
  const keyOf = (args: Partial<Parameters<typeof buildAssessmentCacheKey>[0]> = {}) =>
    buildAssessmentCacheKey({ scope, policies: [policy], request, requestedModel: 'm', ...args })

  it('stores and returns assessments by exact key', () => {
    const cache = createQualityAssessmentCache()
    expect(cache.get({ key: 'k' })).toBeUndefined()
    cache.set({ key: 'k', assessments: [] })
    expect(cache.get({ key: 'k' })).toEqual([])
  })

  it('changes the key with policy version, hashes, state and model, and ignores policy order', () => {
    const base = keyOf()
    expect(keyOf({ policies: [policyNamed({ version: '2' })] })).not.toBe(base)
    expect(keyOf({ scope: scopeNamed({ afterHash: 'a2' }) })).not.toBe(base)
    expect(keyOf({ request: { ...request, state: 'other' } })).not.toBe(base)
    expect(keyOf({ requestedModel: 'm2' })).not.toBe(base)
    const [first, second] = [policyNamed({ id: 'a' }), policyNamed({ id: 'b' })]
    if (first === undefined || second === undefined) throw new Error('fixture')
    expect(keyOf({ policies: [first, second] })).toBe(keyOf({ policies: [second, first] }))
  })
})

describe('readQualityHealth', () => {
  const log = (events: Event[]) => ({ readOwn: async () => events })

  it('reports no review for an empty log', async () => {
    const health = await readQualityHealth({ log: log([]), threadId: THREAD })
    expect(health.status).toBe(EQualityHealthStatus.NoReview)
  })

  it('projects the latest recorded review with its envelope timestamp', async () => {
    const scope = scopeNamed()
    const events = stampHistory({
      batches: [
        [
          buildRecord({ callId: call.callId, workspaceNamespace: 'ns', path: 'src/a.ts', status: EQualityReviewStatus.Skipped, durationMs: 1 }),
          { type: 'nudge', text: 'ignored', lifetimeSteps: 1 },
          buildRecord({ callId: call.callId, workspaceNamespace: 'ns', path: 'src/a.ts', scope, status: EQualityReviewStatus.Completed, durationMs: 1 }),
        ],
      ],
    })
    const health = await readQualityHealth({ log: log(events), threadId: THREAD })
    expect(health.status).toBe(EQualityHealthStatus.CompletedNoFinding)
    expect(health.path).toBe('src/a.ts')
    expect(health.scope).toEqual({ id: 'scope-1', name: 'Widget', kind: 'class' })
    expect(health.recordedAt).toBe('2026-10-06T00:00:00.000Z')
  })
})
