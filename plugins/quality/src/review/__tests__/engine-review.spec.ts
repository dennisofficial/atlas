import { describe, expect, it } from 'bun:test'

import {
  EClassifierFault,
  EQualityFindingState,
  EQualityReviewStatus,
  EQualitySkipReason,
  type ClassifierOutcome,
  type EventDraft,
} from '@dltech/atlas-core'

import {
  IMPROVE,
  INTRODUCE,
  MODEL,
  RESOLVE,
  answersFor,
  calibrated,
  createRig,
  nudgesOf,
  policyNamed,
  recordsOf,
  scopeNamed,
  stampHistory,
  type Verdict,
} from './fixtures'

function verdictRig() {
  const current: { verdict: Verdict; edits: number } = { verdict: INTRODUCE, edits: 0 }
  const rig = createRig({
    classify: async () =>
      calibrated({ answers: answersFor({ verdicts: { srp: current.verdict } }) }),
  })
  const step = async ({
    verdict,
    history,
  }: {
    verdict: Verdict
    history: readonly (readonly EventDraft[])[]
  }) => {
    current.verdict = verdict
    current.edits += 1
    rig.setScopes([
      scopeNamed({
        afterHash: `a${current.edits}`,
        after: `class Widget { run() { return ${current.edits} } }`,
      }),
    ])
    const drafts = await rig.review({ events: stampHistory({ batches: history }) })
    return { drafts, record: recordsOf(drafts)[0], nudges: nudgesOf(drafts) }
  }
  return { rig, step }
}

describe('happy path', () => {
  it('records the finding snapshot and issues one finite consolidated nudge naming the scope and validated evidence', async () => {
    const rig = createRig()
    const drafts = await rig.review()
    const [record] = recordsOf(drafts)
    const [nudge] = nudgesOf(drafts)

    expect(drafts).toHaveLength(2)
    expect(record?.status).toBe(EQualityReviewStatus.Completed)
    expect(record?.path).toBe('src/a.ts')
    expect(record?.requestedModel).toBe(MODEL)
    expect(record?.resolvedModel).toBe(MODEL)
    expect(record?.findings).toHaveLength(1)
    expect(record?.findings[0]).toMatchObject({
      episode: 1,
      state: EQualityFindingState.Active,
      notified: true,
    })
    expect(record?.durationMs).toBeGreaterThan(0)
    expect(nudge?.lifetimeSteps).toBe(1)
    expect(nudge?.text).toContain('Widget')
    expect(nudge?.text).toContain('run method')
    expect(nudge?.text).not.toContain('not-a-real-evidence-id')
    expect(nudge?.text).toContain('written successfully')
    expect(nudge?.text).toContain('leaving it unchanged is fine')
    expect(rig.classifyCalls).toHaveLength(1)
  })

  it('replaces a record that fails schema validation and never nudges from it', async () => {
    const rig = createRig({ policies: [policyNamed({ invalidConcern: true })] })
    const drafts = await rig.review()
    const [record] = recordsOf(drafts)
    expect(record?.status).toBe(EQualityReviewStatus.OperationalError)
    expect(record?.assessments).toEqual([])
    expect(nudgesOf(drafts)).toHaveLength(0)
  })
})

describe('transition-driven ledger from supplied events', () => {
  it('stays silent on repeat introductions (notify once) and when improving', async () => {
    const { step } = verdictRig()
    const first = await step({ verdict: INTRODUCE, history: [] })
    const repeat = await step({ verdict: INTRODUCE, history: [first.drafts] })
    const improved = await step({ verdict: IMPROVE, history: [first.drafts] })

    expect(first.nudges).toHaveLength(1)
    expect(repeat.nudges).toHaveLength(0)
    expect(repeat.record?.findings[0]).toMatchObject({
      episode: 1,
      state: EQualityFindingState.Active,
    })
    expect(improved.nudges).toHaveLength(0)
    expect(improved.drafts).toHaveLength(1)
  })

  it('resolves on a Resolve transition and starts a new episode with a nudge on reintroduction', async () => {
    const { step } = verdictRig()
    const first = await step({ verdict: INTRODUCE, history: [] })
    const resolved = await step({ verdict: RESOLVE, history: [first.drafts] })
    const again = await step({ verdict: INTRODUCE, history: [first.drafts, resolved.drafts] })

    expect(resolved.record?.findings[0]?.state).toBe(EQualityFindingState.Resolved)
    expect(resolved.nudges).toHaveLength(0)
    expect(again.record?.findings[0]).toMatchObject({
      episode: 2,
      state: EQualityFindingState.Active,
    })
    expect(again.nudges).toHaveLength(1)
  })

  it('retires findings on scope deletion without a model call', async () => {
    const { rig, step } = verdictRig()
    const first = await step({ verdict: INTRODUCE, history: [] })
    const callsBefore = rig.classifyCalls.length
    rig.setScopes([scopeNamed({ after: null, afterHash: null })])
    const drafts = await rig.review({ events: stampHistory({ batches: [first.drafts] }) })
    const [record] = recordsOf(drafts)

    expect(rig.classifyCalls).toHaveLength(callsBefore)
    expect(record?.findings[0]?.state).toBe(EQualityFindingState.Resolved)
    expect(nudgesOf(drafts)).toHaveLength(0)
  })

  it('never carries state across calls: the same events fed to a fresh call reproduce the nudge decision', async () => {
    const { rig, step } = verdictRig()
    const first = await step({ verdict: INTRODUCE, history: [] })
    const lost = await rig.review({ events: [] })
    expect(first.nudges).toHaveLength(1)
    expect(nudgesOf(lost)).toHaveLength(1)
  })
})

describe('model identity and faults', () => {
  it('records UncalibratedModel inconclusive for a different model and never a finding', async () => {
    const rig = createRig({
      classify: async () =>
        calibrated({
          answers: answersFor({ verdicts: { srp: INTRODUCE } }),
          model: 'something-else',
        }),
    })
    const drafts = await rig.review()
    expect(recordsOf(drafts)[0]).toMatchObject({
      status: EQualityReviewStatus.Inconclusive,
      reason: EQualitySkipReason.UncalibratedModel,
      findings: [],
      assessments: [],
    })
    expect(nudgesOf(drafts)).toHaveLength(0)
  })

  it('records DecisionUnavailable for ok:false', async () => {
    const rig = createRig({
      classify: async () => ({ ok: false, fault: EClassifierFault.Unavailable, detail: 'timeout' }),
    })
    const [record] = recordsOf(await rig.review())
    expect(record).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.DecisionUnavailable,
      detail: 'unavailable: timeout',
    })
  })

  it('keeps a faulted scope as a fault while the other scope reviews normally', async () => {
    const rig = createRig({
      scopes: [
        scopeNamed(),
        scopeNamed({ id: 'scope-2', name: 'Broken', after: 'class Broken {}' }),
      ],
      classify: async ({ state }) =>
        state.includes('class Broken')
          ? { ok: false, fault: EClassifierFault.Rejected, detail: 'provider down' }
          : calibrated({ answers: answersFor({ verdicts: { srp: INTRODUCE } }) }),
    })
    const drafts = await rig.review()
    const byScope = new Map(recordsOf(drafts).map((record) => [record.scope?.id, record]))

    expect(byScope.get('scope-2')).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.DecisionUnavailable,
      findings: [],
    })
    expect(byScope.get('scope-1')?.status).toBe(EQualityReviewStatus.Completed)
    const [nudge] = nudgesOf(drafts)
    expect(nudge?.text).toContain('Widget')
    expect(nudge?.text).not.toContain('Broken')
  })
})

describe('deadline and cancellation', () => {
  it('records ReviewDeadline when the classifier never resolves', async () => {
    const rig = createRig({ deadlineMs: 20, classify: () => new Promise(() => {}) })
    const drafts = await rig.review()
    expect(drafts).toHaveLength(1)
    expect(recordsOf(drafts)[0]).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.ReviewDeadline,
    })
  })

  it('discards a late result from a classifier that ignores the signal', async () => {
    let calls = 0
    const rig = createRig({
      deadlineMs: 20,
      classify: async () => {
        calls += 1
        if (calls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 60))
        }
        return calibrated({ answers: answersFor({ verdicts: { srp: INTRODUCE } }) })
      },
    })
    const first = await rig.review()
    expect(first).toHaveLength(1)
    expect(recordsOf(first)[0]?.reason).toBe(EQualitySkipReason.ReviewDeadline)

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(first).toHaveLength(1)

    const second = await rig.review({ events: stampHistory({ batches: [first] }) })
    expect(recordsOf(second)[0]?.findings[0]).toMatchObject({ episode: 1, notified: true })
    expect(nudgesOf(second)).toHaveLength(1)
  })

  it('records TurnInterrupted and no nudge when the caller aborts mid-review', async () => {
    const rig = createRig({ classify: () => new Promise<ClassifierOutcome>(() => {}) })
    const controller = new AbortController()
    const pending = rig.review({ signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    const drafts = await pending
    expect(recordsOf(drafts)[0]).toMatchObject({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.TurnInterrupted,
    })
    expect(nudgesOf(drafts)).toHaveLength(0)
  })
})

describe('repeat reviews', () => {
  it('asks the classifier again for an identical request and recomputes the nudge from the ledger', async () => {
    const rig = createRig()
    const first = await rig.review()
    const second = await rig.review()
    expect(rig.classifyCalls).toHaveLength(2)
    expect(recordsOf(second)[0]?.assessments).toEqual(recordsOf(first)[0]?.assessments)
    expect(nudgesOf(first)).toHaveLength(1)
    expect(nudgesOf(second)).toHaveLength(1)

    const third = await rig.review({ events: stampHistory({ batches: [first] }) })
    expect(nudgesOf(third)).toHaveLength(0)
  })

  it('does not reuse an outcome from a faulted call', async () => {
    const rig = createRig({
      classify: async () => ({ ok: false, fault: EClassifierFault.Unavailable, detail: 'x' }),
    })
    await rig.review()
    await rig.review()
    expect(rig.classifyCalls).toHaveLength(2)
  })
})
