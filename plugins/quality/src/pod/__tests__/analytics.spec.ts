import { describe, expect, it } from 'bun:test'

import {
  EClassifierFault,
  EQualityFindingState,
  EQualityImpact,
  EQualityLanguage,
  EQualityReviewStatus,
  EQualityScopeKind,
  EQualitySkipReason,
  EQualityTransition,
  ETurnCause,
  toEventId,
  toRunId,
  type CodeQualityReviewedBody,
  type Hash,
  type QualityScopeIdentity,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import type { PodAnalyticsValue } from '@dltech/atlas-plugin-sdk'

import { ignoredFindingProperties } from '../analytics/ignored-properties'
import { resolvedFindingProperties } from '../analytics/review-properties'
import { CALL, FILE, PROJECT, THREAD, analyticsRecorder, createRig, wroteNothing } from './support'

const HASH = 'a'.repeat(64) as Hash

const eventsOf = (bodies: readonly V2Body[]): readonly V2Event[] =>
  bodies.map(
    (body, index) =>
      ({
        ...body,
        id: toEventId(`event-${index + 1}`),
        seq: index + 1,
        threadId: THREAD,
        runId: toRunId('run-1'),
        depth: 0,
        at: '2026-11-23T00:00:00.000Z',
        epoch: 1,
        prevHash: HASH,
      }) as V2Event,
  )

const SCOPE: QualityScopeIdentity = {
  id: 'scope-1',
  workspaceNamespace: PROJECT,
  path: 'src/widget.ts',
  language: EQualityLanguage.TypeScript,
  kind: EQualityScopeKind.Class,
  name: 'Widget',
  adapterVersion: 'ts-1',
  structuralHash: 'sh-1',
  parentScopeId: null,
  lineRange: null,
}

const reviewed = (args: {
  state: EQualityFindingState
  notified: boolean
  transition: EQualityTransition
}): CodeQualityReviewedBody => ({
  type: 'code-quality-reviewed',
  callId: CALL,
  workspaceNamespace: PROJECT,
  path: 'src/widget.ts',
  scope: SCOPE,
  beforeHash: null,
  afterHash: 'a1',
  status: EQualityReviewStatus.Completed,
  assessments: [
    {
      policyId: 'single-responsibility',
      policyVersion: '1',
      scopeId: 'scope-1',
      status: EQualityReviewStatus.Completed,
      impact: EQualityImpact.Introduced,
      currentConcernProbability: 0.9,
      transition: args.transition,
      evidenceIds: [],
      rawAnswers: {},
    },
  ],
  findings: [
    {
      id: 'single-responsibility:scope-1:1',
      policyId: 'single-responsibility',
      scopeId: 'scope-1',
      episode: 1,
      state: args.state,
      notified: args.notified,
      lastAfterHash: 'a1',
      policyVersion: '1',
    },
  ],
  durationMs: 5,
})

const said: V2Body = { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] }
const turnStarted: V2Body = { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }

const notified = (): CodeQualityReviewedBody =>
  reviewed({
    state: EQualityFindingState.Active,
    notified: true,
    transition: EQualityTransition.Introduce,
  })

const resolved = (): CodeQualityReviewedBody =>
  reviewed({
    state: EQualityFindingState.Resolved,
    notified: true,
    transition: EQualityTransition.Resolve,
  })

describe('resolvedFindingProperties', () => {
  const events = eventsOf([notified(), said, said])

  it('counts the steps and the turns since the record that notified the finding', () => {
    expect(resolvedFindingProperties({ records: [resolved()], events, threadId: THREAD })).toEqual([
      { policy_id: 'single-responsibility', steps_after_nudge: 2, turns_after_nudge: 0 },
    ])
  })

  it('counts a turn that started after the nudge', () => {
    const withTurn = eventsOf([notified(), said, turnStarted, said])

    expect(
      resolvedFindingProperties({ records: [resolved()], events: withTurn, threadId: THREAD })[0],
    ).toMatchObject({ steps_after_nudge: 2, turns_after_nudge: 1 })
  })

  it('says nothing for a finding that was never notified', () => {
    const unnotified = eventsOf([
      reviewed({
        state: EQualityFindingState.Active,
        notified: false,
        transition: EQualityTransition.Introduce,
      }),
    ])
    const record = reviewed({
      state: EQualityFindingState.Resolved,
      notified: false,
      transition: EQualityTransition.Resolve,
    })

    expect(
      resolvedFindingProperties({ records: [record], events: unnotified, threadId: THREAD }),
    ).toEqual([])
  })

  it('says nothing for a finding that was already resolved', () => {
    const alreadyResolved = eventsOf([resolved()])

    expect(
      resolvedFindingProperties({
        records: [resolved()],
        events: alreadyResolved,
        threadId: THREAD,
      }),
    ).toEqual([])
  })
})

describe('ignoredFindingProperties', () => {
  it('reports a finding notified in the turn and still active at its end', () => {
    const events = eventsOf([turnStarted, notified(), said])

    expect(ignoredFindingProperties({ events, threadId: THREAD })).toEqual([
      { policy_id: 'single-responsibility', steps_after_nudge: 1 },
    ])
  })

  it('says nothing when the finding was resolved before the turn ended', () => {
    const events = eventsOf([turnStarted, notified(), said, resolved()])

    expect(ignoredFindingProperties({ events, threadId: THREAD })).toEqual([])
  })

  it('says nothing for a finding notified before the turn started', () => {
    const events = eventsOf([notified(), turnStarted, said])

    expect(ignoredFindingProperties({ events, threadId: THREAD })).toEqual([])
  })

  it('does not fire again when a later turn only re-records the same nudge', () => {
    const firstTurn = eventsOf([turnStarted, notified(), said])
    const secondTurn = eventsOf([turnStarted, notified(), said, turnStarted, notified(), said])

    expect(ignoredFindingProperties({ events: firstTurn, threadId: THREAD })).toHaveLength(1)
    expect(ignoredFindingProperties({ events: secondTurn, threadId: THREAD })).toEqual([])
  })
})

const stringsIn = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) =>
    typeof entry === 'object' && entry !== null
      ? Object.values(entry).flatMap((held) => stringsIn(held))
      : stringsIn(entry),
  )
}

const stringsOf = (properties: Readonly<Record<string, PodAnalyticsValue>>): readonly string[] =>
  Object.values(properties).flatMap((value) => stringsIn(value))

describe('the completed review event', () => {
  it('reports status, policies, files and the classifier that answered', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run()

    expect(captured).toHaveLength(1)
    expect(captured[0]?.event).toBe('quality review completed')
    expect(captured[0]?.properties).toMatchObject({
      status: 'completed',
      skip_reason: null,
      policy_ids: ['single-responsibility'],
      policies: [
        { policy_id: 'single-responsibility', outcome: 'new_finding', max_confidence: 0.9 },
      ],
      files: 1,
      notified: true,
      classifier_model: 'jev-latest',
      classifier_provider: 'jev',
      language: 'typescript',
      input_tokens: null,
      first_review_in_session: true,
    })
  })

  it('reports a deadline', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({
      analytics,
      budgetMs: 10,
      classify: () => new Promise(() => undefined),
    })

    await rig.run()

    expect(captured[0]?.properties).toMatchObject({
      status: 'deadline',
      skip_reason: EQualitySkipReason.ReviewDeadline,
      notified: false,
    })
    expect(Number(captured[0]?.properties.total_ms)).toBeGreaterThan(0)
  })

  it('reports an operational error when the classifier fails', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({
      analytics,
      classify: async () => ({
        ok: false,
        fault: EClassifierFault.Rejected,
        detail: '503',
      }),
    })

    await rig.run()

    expect(captured[0]?.properties).toMatchObject({ status: 'operational_error' })
  })

  it('reports a review skipped outside the workspace', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run({ projectDirectory: '/elsewhere' })

    expect(captured[0]?.properties).toMatchObject({
      status: 'skipped',
      skip_reason: EQualitySkipReason.OutsideWorkspace,
    })
  })

  it('knows this is not the first review in the session', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics, events: eventsOf([notified()]) as never })

    await rig.run()

    expect(captured[0]?.properties).toMatchObject({ first_review_in_session: false })
  })

  it('sends only ids, enums, numbers and booleans', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run()

    const strings = stringsOf(captured[0]?.properties ?? {})
    expect(strings).not.toContain(FILE)
    expect(strings).not.toContain('Widget')
    for (const value of strings) expect(value).toMatch(/^[a-z0-9_.:-]+$/i)
  })

  it('sends nothing when the write captured no change', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run({ result: wroteNothing() })

    expect(captured).toEqual([])
  })
})

describe('the ignored event through the after-turn hook', () => {
  it('fires once at the end of the turn that carried the nudge', async () => {
    const { captured, analytics } = analyticsRecorder()
    const reviewRig = createRig({ analytics })
    const outcome = await reviewRig.run()
    const events = eventsOf([turnStarted, ...((outcome.drafts ?? []) as readonly V2Body[]), said])
    const turnRig = createRig({ analytics, events: events as never })

    await turnRig.ignored.run({ threadId: THREAD })

    expect(captured).toEqual([
      {
        event: 'quality review completed',
        properties: expect.objectContaining({ status: 'completed' }),
      },
      {
        event: 'quality finding ignored',
        properties: { policy_id: 'single-responsibility', steps_after_nudge: 1 },
      },
    ])
  })
})
