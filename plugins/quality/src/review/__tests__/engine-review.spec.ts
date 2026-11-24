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
  FILE,
  IMPROVE,
  INTRODUCE,
  MODEL,
  RESOLVE,
  answersFor,
  calibrated,
  createRig,
  contextOf,
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
    return { result: drafts, record: recordsOf(drafts)[0], context: contextOf(drafts) }
  }
  return { rig, step }
}

describe('happy path', () => {
  it('records the finding snapshot and issues one finite consolidated nudge naming the scope and validated evidence', async () => {
    const rig = createRig()
    const result = await rig.review()
    const [record] = recordsOf(result)
    const context = contextOf(result)

    expect(recordsOf(result)).toHaveLength(1)
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
    expect(context).toContain('Widget')
    expect(context).toContain('run method')
    expect(context).not.toContain('not-a-real-evidence-id')
    expect(context).toContain('written successfully')
    expect(context).toContain('leaving it unchanged is fine')
    expect(rig.classifyCalls).toHaveLength(1)
  })

  it('keys one note per reviewed file, so a later review of that file replaces it', async () => {
    const rig = createRig({
      scopesOfChange: (change) =>
        change.path.endsWith('b.ts')
          ? [scopeNamed({ id: 'scope-b', path: '/repo/src/b.ts', name: 'Gadget' })]
          : [scopeNamed()],
    })
    const reviewed = await rig.review({
      changes: [
        { path: '/repo/src/b.ts', before: 'old', after: 'new' },
        { path: FILE, before: 'old', after: 'new' },
      ],
    })

    expect(reviewed.notes.map((note) => note.key)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(reviewed.notes[0]?.content).toContain('src/a.ts was written successfully')
    expect(reviewed.notes[0]?.content).not.toContain('src/b.ts')
    expect(reviewed.notes[1]?.content).toContain('src/b.ts was written successfully')
    expect(reviewed.notes[1]?.content).toContain('Gadget')
  })

  it('replaces a record that fails schema validation and never nudges from it', async () => {
    const rig = createRig({ policies: [policyNamed({ invalidConcern: true })] })
    const result = await rig.review()
    const [record] = recordsOf(result)
    expect(record?.status).toBe(EQualityReviewStatus.OperationalError)
    expect(record?.assessments).toEqual([])
    expect(contextOf(result)).toBeUndefined()
  })
})

describe('transition-driven ledger from supplied events', () => {
  it('stays silent on repeat introductions (notify once) and when improving', async () => {
    const { step } = verdictRig()
    const first = await step({ verdict: INTRODUCE, history: [] })
    const repeat = await step({ verdict: INTRODUCE, history: [recordsOf(first.result)] })
    const improved = await step({ verdict: IMPROVE, history: [recordsOf(first.result)] })

    expect(first.context).toBeDefined()
    expect(repeat.context).toBeUndefined()
    expect(repeat.record?.findings[0]).toMatchObject({
      episode: 1,
      state: EQualityFindingState.Active,
    })
    expect(improved.context).toBeUndefined()
    expect(recordsOf(improved.result)).toHaveLength(1)
  })

  it('resolves on a Resolve transition and starts a new episode with a nudge on reintroduction', async () => {
    const { step } = verdictRig()
    const first = await step({ verdict: INTRODUCE, history: [] })
    const resolved = await step({ verdict: RESOLVE, history: [recordsOf(first.result)] })
    const again = await step({
      verdict: INTRODUCE,
      history: [recordsOf(first.result), recordsOf(resolved.result)],
    })

    expect(resolved.record?.findings[0]?.state).toBe(EQualityFindingState.Resolved)
    expect(resolved.context).toBeUndefined()
    expect(again.record?.findings[0]).toMatchObject({
      episode: 2,
      state: EQualityFindingState.Active,
    })
    expect(again.context).toBeDefined()
  })

  it('retires findings on scope deletion without a model call', async () => {
    const { rig, step } = verdictRig()
    const first = await step({ verdict: INTRODUCE, history: [] })
    const callsBefore = rig.classifyCalls.length
    rig.setScopes([scopeNamed({ after: null, afterHash: null })])
    const drafts = await rig.review({
      events: stampHistory({ batches: [recordsOf(first.result)] }),
    })
    const [record] = recordsOf(drafts)

    expect(rig.classifyCalls).toHaveLength(callsBefore)
    expect(record?.findings[0]?.state).toBe(EQualityFindingState.Resolved)
    expect(contextOf(drafts)).toBeUndefined()
  })

  it('never carries state across calls: the same events fed to a fresh call reproduce the nudge decision', async () => {
    const { rig, step } = verdictRig()
    const first = await step({ verdict: INTRODUCE, history: [] })
    const lost = await rig.review({ events: [] })
    expect(first.context).toBeDefined()
    expect(contextOf(lost)).toBeDefined()
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
    expect(contextOf(drafts)).toBeUndefined()
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
    const context = contextOf(drafts)
    expect(context).toContain('Widget')
    expect(context).not.toContain('Broken')
  })
})

describe('deadline and cancellation', () => {
  it('records ReviewDeadline when the classifier never resolves', async () => {
    const rig = createRig({ deadlineMs: 20, classify: () => new Promise(() => {}) })
    const result = await rig.review()
    expect(recordsOf(result)).toHaveLength(1)
    expect(recordsOf(result)[0]).toMatchObject({
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
    expect(recordsOf(first)).toHaveLength(1)
    expect(recordsOf(first)[0]?.reason).toBe(EQualitySkipReason.ReviewDeadline)

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(recordsOf(first)).toHaveLength(1)

    const second = await rig.review({ events: stampHistory({ batches: [recordsOf(first)] }) })
    expect(recordsOf(second)[0]?.findings[0]).toMatchObject({ episode: 1, notified: true })
    expect(contextOf(second)).toBeDefined()
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
    expect(contextOf(drafts)).toBeUndefined()
  })
})

describe('repeat reviews', () => {
  it('asks the classifier again for an identical request and recomputes the nudge from the ledger', async () => {
    const rig = createRig()
    const first = await rig.review()
    const second = await rig.review()
    expect(rig.classifyCalls).toHaveLength(2)
    expect(recordsOf(second)[0]?.assessments).toEqual(recordsOf(first)[0]?.assessments)
    expect(contextOf(first)).toBeDefined()
    expect(contextOf(second)).toBeDefined()

    const third = await rig.review({ events: stampHistory({ batches: [recordsOf(first)] }) })
    expect(contextOf(third)).toBeUndefined()
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
