import { describe, expect, it } from 'bun:test'

import { EQualityReviewStatus, EQualitySkipReason } from '@dltech/atlas-core'

import { INTRODUCE, answersFor, calibrated, createRig, nudgesOf, policyNamed, recordsOf, scopeNamed } from './fixtures'

const KIB = 1024

describe('scope selection', () => {
  it('records ScopeIdentityUncertain for a duplicate selection and never asks the model about that scope', async () => {
    const rig = createRig({ policies: [policyNamed({ select: () => ['scope-1', 'scope-1'] })] })
    const drafts = await rig.review()
    expect(rig.decisionCalls).toHaveLength(0)
    expect(recordsOf(drafts)[0]).toMatchObject({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.ScopeIdentityUncertain,
      scope: { id: 'scope-1' },
    })
  })

  it('records ScopeIdentityUncertain for an unknown selected id instead of dropping it', async () => {
    const rig = createRig({ policies: [policyNamed({ select: () => ['ghost', 'scope-1'] })] })
    const drafts = await rig.review()
    const reasons = recordsOf(drafts).map((record) => record.reason)
    expect(reasons).toContain(EQualitySkipReason.ScopeIdentityUncertain)
    expect(recordsOf(drafts).some((record) => record.detail?.includes('ghost'))).toBe(true)
    expect(rig.decisionCalls).toHaveLength(1)
  })

  it('reviews only policy-selected scopes and batches policies that selected the same scope', async () => {
    const rig = createRig({
      policies: [policyNamed({ id: 'a' }), policyNamed({ id: 'b', select: (ids) => ids.slice(0, 1) })],
      scopes: [scopeNamed(), scopeNamed({ id: 'scope-2', name: 'Other', after: 'class Other {}' })],
      decide: async ({ questions }) => {
        const ids = [...new Set(Object.keys(questions).map((key) => key.split(':')[0] ?? ''))]
        return calibrated({ answers: answersFor({ verdicts: Object.fromEntries(ids.map((id) => [id, INTRODUCE])) }) })
      },
    })
    const drafts = await rig.review()
    expect(rig.decisionCalls).toHaveLength(2)
    const sizes = rig.decisionCalls.map((args) => Object.keys(args.questions).length).sort()
    expect(sizes).toEqual([2, 4])
    expect(nudgesOf(drafts)).toHaveLength(1)
  })

  it('skips disabled policies by their setting key', async () => {
    const rig = createRig({ settings: { 'quality.enabled': true, 'quality.policies.srp': false } })
    const drafts = await rig.review()
    expect(rig.decisionCalls).toHaveLength(0)
    expect(recordsOf(drafts)).toHaveLength(0)
  })
})

describe('size bounds', () => {
  const both = (definitionBytes: number) => [policyNamed({ id: 'a', definitionBytes }), policyNamed({ id: 'b', definitionBytes })]
  const allPolicies = async ({ questions }: { questions: Record<string, unknown> }) =>
    calibrated({
      answers: answersFor({ verdicts: Object.fromEntries([...new Set(Object.keys(questions).map((key) => key.split(':')[0] ?? ''))].map((id) => [id, INTRODUCE])) }),
    })

  it('sends one shared request when under bound', async () => {
    const rig = createRig({ policies: both(1 * KIB), decide: allPolicies })
    await rig.review()
    expect(rig.decisionCalls).toHaveLength(1)
  })

  it('falls back to per-policy requests when the shared request is over bound', async () => {
    const rig = createRig({ policies: both(15 * KIB), decide: allPolicies })
    const drafts = await rig.review()
    expect(rig.decisionCalls).toHaveLength(2)
    expect(recordsOf(drafts)).toHaveLength(1)
    expect(recordsOf(drafts)[0]?.assessments.map((assessment) => assessment.policyId).sort()).toEqual(['a', 'b'])
  })

  it('records OversizedRequest when a single-policy request is still over bound', async () => {
    const rig = createRig({ policies: [policyNamed({ definitionBytes: 30 * KIB })] })
    const drafts = await rig.review()
    expect(rig.decisionCalls).toHaveLength(0)
    expect(recordsOf(drafts)[0]).toMatchObject({ status: EQualityReviewStatus.Skipped, reason: EQualitySkipReason.OversizedRequest })
    expect(nudgesOf(drafts)).toHaveLength(0)
  })

  it('counts UTF-8 bytes, not characters', async () => {
    const rig = createRig({ policies: [policyNamed({ definitionBytes: 9 * KIB })], scopes: [scopeNamed({ after: '€'.repeat(5 * KIB) })] })
    await rig.review()
    expect(rig.decisionCalls).toHaveLength(0)
  })
})
