import { describe, expect, it } from 'bun:test'

import {
  EClassifierFault,
  EQualityFindingState,
  EQualitySkipReason,
  EQualityTransition,
  type RecordEventBody,
} from '@dltech/atlas-core'
import type { PodAnalyticsValue } from '@dltech/atlas-plugin-sdk'

import { resolvedFindingProperties } from '../analytics/review-properties'
import {
  briefSaid,
  eventsOf,
  notified,
  resolved,
  reviewed,
  said,
  turnStarted,
  wakeConsumed,
} from './finding-fixtures'
import { FILE, THREAD, analyticsRecorder, createRig, wroteNothing } from './support'

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

  it('counts a sub-agent run woken after the nudge as a turn', () => {
    const subagent = eventsOf([briefSaid, notified(), said, wakeConsumed, said])

    expect(
      resolvedFindingProperties({ records: [resolved()], events: subagent, threadId: THREAD })[0],
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
    const events = eventsOf([
      turnStarted,
      ...((outcome.drafts ?? []) as readonly RecordEventBody[]),
      said,
    ])
    const turnRig = createRig({ analytics, events: events as never })

    await turnRig.ignored.run({ threadId: THREAD })

    expect(captured).toEqual([
      {
        event: 'quality review completed',
        properties: expect.objectContaining({ status: 'completed' }),
      },
      {
        event: 'quality finding ignored',
        properties: {
          policy_id: 'single-responsibility',
          steps_after_nudge: 1,
          turns_after_nudge: 0,
        },
      },
    ])
  })
})
