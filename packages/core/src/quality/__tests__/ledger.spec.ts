import { describe, expect, it } from 'bun:test'

import { activeFindings, applyAssessments, findingId, foldQualityFindings } from '../ledger'
import { EQualityFindingState, EQualityReviewStatus, EQualityTransition, type QualityFinding } from '../policy'
import { assessmentFixture, reviewFixture, scopeFixture } from './fixtures'

const finding = (overrides: Partial<QualityFinding> = {}): QualityFinding => ({
  id: findingId({ policyId: 'srp', scopeId: 'scope-1', episode: 1 }),
  policyId: 'srp',
  scopeId: 'scope-1',
  episode: 1,
  state: EQualityFindingState.Active,
  notified: true,
  lastAfterHash: 'a0',
  policyVersion: '1',
  ...overrides,
})

const step = ({
  previous = [],
  transition,
  status = EQualityReviewStatus.Completed,
}: {
  previous?: readonly QualityFinding[]
  transition: EQualityTransition
  status?: EQualityReviewStatus
}) =>
  applyAssessments({
    previous,
    assessments: [assessmentFixture({ transition, status })],
    afterHash: 'a1',
    scopeDeleted: false,
  })

describe('applyAssessments transition table', () => {
  it('opens a notified episode on Introduce with no finding', () => {
    const result = step({ transition: EQualityTransition.Introduce })
    expect(result.findings).toEqual([finding({ notified: true, lastAfterHash: 'a1' })])
    expect(result.notifiable).toHaveLength(1)
  })

  it('opens a silent episode on TrackDebt with no finding', () => {
    const result = step({ transition: EQualityTransition.TrackDebt })
    expect(result.findings[0]?.notified).toBe(false)
    expect(result.findings[0]?.state).toBe(EQualityFindingState.Active)
    expect(result.notifiable).toEqual([])
  })

  it('notifies a tracked-debt finding once on later Introduce, then stays silent', () => {
    const debt = finding({ notified: false })
    const first = step({ previous: [debt], transition: EQualityTransition.Introduce })
    expect(first.findings[0]?.notified).toBe(true)
    expect(first.findings[0]?.episode).toBe(1)
    expect(first.notifiable).toHaveLength(1)

    const second = step({ previous: first.findings, transition: EQualityTransition.Introduce })
    expect(second.notifiable).toEqual([])
    expect(second.findings[0]?.lastAfterHash).toBe('a1')
  })

  it('updates an unnotified finding silently on TrackDebt', () => {
    const result = step({ previous: [finding({ notified: false })], transition: EQualityTransition.TrackDebt })
    expect(result.findings[0]?.notified).toBe(false)
    expect(result.findings[0]?.lastAfterHash).toBe('a1')
    expect(result.notifiable).toEqual([])
  })

  it('updates a notified finding silently on TrackDebt', () => {
    const result = step({ previous: [finding()], transition: EQualityTransition.TrackDebt })
    expect(result.findings[0]?.notified).toBe(true)
    expect(result.notifiable).toEqual([])
  })

  it('resolves an existing finding on Resolve', () => {
    const result = step({ previous: [finding()], transition: EQualityTransition.Resolve })
    expect(result.findings[0]?.state).toBe(EQualityFindingState.Resolved)
    expect(result.notifiable).toEqual([])
  })

  it('creates nothing when Resolve arrives with no finding', () => {
    const result = step({ transition: EQualityTransition.Resolve })
    expect(result.findings).toEqual([])
    expect(result.notifiable).toEqual([])
  })

  it('starts a new notified episode when a resolved concern is reintroduced', () => {
    const resolved = finding({ state: EQualityFindingState.Resolved })
    const result = step({ previous: [resolved], transition: EQualityTransition.Introduce })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({ episode: 2, state: EQualityFindingState.Active, notified: true })
    expect(result.findings[0]?.id).toBe(findingId({ policyId: 'srp', scopeId: 'scope-1', episode: 2 }))
    expect(result.notifiable).toHaveLength(1)
  })

  it('starts a silent new episode when a resolved concern returns as TrackDebt', () => {
    const resolved = finding({ state: EQualityFindingState.Resolved })
    const result = step({ previous: [resolved], transition: EQualityTransition.TrackDebt })
    expect(result.findings[0]).toMatchObject({ episode: 2, notified: false })
    expect(result.notifiable).toEqual([])
  })

  it('leaves state untouched on None', () => {
    const previous = [finding({ notified: false })]
    const result = step({ previous, transition: EQualityTransition.None })
    expect(result.findings).toEqual(previous)
    expect(result.notifiable).toEqual([])
  })

  it.each([EQualityReviewStatus.Skipped, EQualityReviewStatus.Inconclusive, EQualityReviewStatus.OperationalError])(
    'never moves findings on a %s assessment',
    (status) => {
      const previous = [finding()]
      for (const transition of [EQualityTransition.Resolve, EQualityTransition.Introduce]) {
        expect(step({ previous, transition, status }).findings).toEqual(previous)
      }
    },
  )

  it('keeps findings of other policies on the scope and tracks policies independently', () => {
    const other = finding({ policyId: 'other', id: 'other:scope-1:1' })
    const result = applyAssessments({
      previous: [other],
      assessments: [assessmentFixture({ transition: EQualityTransition.Introduce })],
      afterHash: 'a1',
      scopeDeleted: false,
    })
    expect(result.findings.map((entry) => entry.policyId).sort()).toEqual(['other', 'srp'])
    expect(result.notifiable.map((entry) => entry.policyId)).toEqual(['srp'])
  })

  it('retires every active finding when the scope is deleted, regardless of assessments', () => {
    const result = applyAssessments({
      previous: [finding(), finding({ policyId: 'other', id: 'other:scope-1:1' })],
      assessments: [assessmentFixture({ transition: EQualityTransition.Introduce })],
      afterHash: null,
      scopeDeleted: true,
    })
    expect(result.findings.every((entry) => entry.state === EQualityFindingState.Resolved)).toBe(true)
    expect(result.findings.every((entry) => entry.lastAfterHash === null)).toBe(true)
    expect(result.notifiable).toEqual([])
  })

  it('does not mutate its input', () => {
    const previous = [finding({ notified: false })]
    const snapshot = structuredClone(previous)
    step({ previous, transition: EQualityTransition.Introduce })
    expect(previous).toEqual(snapshot)
  })
})

describe('foldQualityFindings', () => {
  const scope = scopeFixture()
  const identity = { ...scope }

  it('keeps the latest snapshot per scope and ignores file-level records', () => {
    const records = [
      reviewFixture({ scope: identity, findings: [finding({ notified: false })] }),
      reviewFixture({ scope: { ...identity, id: 'scope-2' }, findings: [finding({ scopeId: 'scope-2' })] }),
      reviewFixture({ status: EQualityReviewStatus.Skipped }),
      reviewFixture({ scope: identity, findings: [finding()] }),
    ]
    const folded = foldQualityFindings({ records })
    expect([...folded.keys()]).toEqual(['scope-1', 'scope-2'])
    expect(folded.get('scope-1')?.[0]?.notified).toBe(true)
  })

  it('lists only active findings', () => {
    const findings = [finding(), finding({ policyId: 'x', state: EQualityFindingState.Resolved })]
    expect(activeFindings({ findings })).toHaveLength(1)
  })
})
