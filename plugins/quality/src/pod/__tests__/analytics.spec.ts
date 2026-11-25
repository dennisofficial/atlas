import { describe, expect, it } from 'bun:test'

import {
  EClassifierFault,
  EQualityFindingState,
  EQualitySkipReason,
  EQualityTransition,
  type RecordEventBody,
} from '@dltech/atlas-core'
import { EAnalyticsLinks, type PodAnalyticsValue } from '@dltech/atlas-plugin-sdk'

import { forgetNudgedFindings } from '../analytics/nudge-review'
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
import { FILE, THREAD, analyticsRecorder, completedOf, createRig, wroteNothing } from './support'

const REVIEW_ID = 'review-1'

describe('resolvedFindingProperties', () => {
  const events = eventsOf([notified(), said, said])

  it('counts the steps and the turns since the record that notified the finding', () => {
    expect(
      resolvedFindingProperties({
        reviewId: REVIEW_ID,
        records: [resolved()],
        events,
        threadId: THREAD,
      }),
    ).toEqual([
      {
        review_id: REVIEW_ID,
        policy_id: 'single-responsibility',
        steps_after_nudge: 2,
        turns_after_nudge: 0,
      },
    ])
  })

  it('counts a turn that started after the nudge', () => {
    const withTurn = eventsOf([notified(), said, turnStarted, said])

    expect(
      resolvedFindingProperties({
        reviewId: REVIEW_ID,
        records: [resolved()],
        events: withTurn,
        threadId: THREAD,
      })[0],
    ).toMatchObject({ steps_after_nudge: 2, turns_after_nudge: 1 })
  })

  it('counts a sub-agent run woken after the nudge as a turn', () => {
    const subagent = eventsOf([briefSaid, notified(), said, wakeConsumed, said])

    expect(
      resolvedFindingProperties({
        reviewId: REVIEW_ID,
        records: [resolved()],
        events: subagent,
        threadId: THREAD,
      })[0],
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
      resolvedFindingProperties({
        reviewId: REVIEW_ID,
        records: [record],
        events: unnotified,
        threadId: THREAD,
      }),
    ).toEqual([])
  })

  it('says nothing for a finding that was already resolved', () => {
    const alreadyResolved = eventsOf([resolved()])

    expect(
      resolvedFindingProperties({
        reviewId: REVIEW_ID,
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
  it('reports status, verdicts, extents and the classifier that answered', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run()

    const completed = completedOf(captured)
    expect(completed?.properties).toMatchObject({
      status: 'completed',
      skip_reason: null,
      skip_reasons: [],
      policy_ids: ['single-responsibility'],
      policies: [{ policy_id: 'single-responsibility', verdict: 'nudged', max_concern: 0.9 }],
      files: 1,
      notified: true,
      tool: 'write',
      scopes_total: 1,
      scopes_selected: 1,
      extensions: ['.ts'],
      classifier_model: 'jev-latest',
      classifier_provider: 'jev',
      language: 'typescript',
      input_tokens: null,
      first_review_in_session: true,
    })
    expect(String(completed?.properties.review_id)).toMatch(/^[0-9a-f-]{36}$/)
    expect(completed?.links).toBe(EAnalyticsLinks.Hashed)
  })

  it('counts every skip reason of the run', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run({ projectDirectory: '/elsewhere' })

    const completed = completedOf(captured)
    expect(completed?.properties).toMatchObject({
      status: 'skipped',
      skip_reason: EQualitySkipReason.OutsideWorkspace,
      skip_reasons: [EQualitySkipReason.OutsideWorkspace],
      scopes_total: 0,
      scopes_selected: 0,
      extensions: ['.ts'],
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

    expect(completedOf(captured)?.properties).toMatchObject({
      status: 'deadline',
      skip_reason: EQualitySkipReason.ReviewDeadline,
      notified: false,
    })
    expect(Number(completedOf(captured)?.properties.total_ms)).toBeGreaterThan(0)
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

    expect(completedOf(captured)?.properties).toMatchObject({ status: 'operational_error' })
  })

  it('reports a review skipped outside the workspace', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run({ projectDirectory: '/elsewhere' })

    expect(completedOf(captured)?.properties).toMatchObject({
      status: 'skipped',
      skip_reason: EQualitySkipReason.OutsideWorkspace,
    })
  })

  it('knows this is not the first review in the session', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics, events: eventsOf([notified()]) as never })

    await rig.run()

    expect(completedOf(captured)?.properties).toMatchObject({ first_review_in_session: false })
  })

  it('sends only ids, enums, numbers and booleans', async () => {
    const { captured, analytics } = analyticsRecorder()
    const rig = createRig({ analytics })

    await rig.run()

    const strings = stringsOf(completedOf(captured)?.properties ?? {})
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

describe('the nudge reaction through the after-turn hook', () => {
  it('reports the reaction once, linked to the review that nudged', async () => {
    forgetNudgedFindings()
    const { captured, analytics } = analyticsRecorder()
    const reviewRig = createRig({ analytics })
    const outcome = await reviewRig.run()
    const reviewId = completedOf(captured)?.properties['review_id']
    const events = eventsOf([
      turnStarted,
      ...((outcome.drafts ?? []) as readonly RecordEventBody[]),
      said,
    ])
    const turnRig = createRig({ analytics, events: events as never })

    await turnRig.ignored.run({ threadId: THREAD })

    expect(captured.find((one) => one.event === 'quality nudge reaction')).toMatchObject({
      properties: {
        review_id: reviewId,
        policy_id: 'single-responsibility',
        reaction: 'untouched',
        mentioned_in_reply: false,
        steps_after_nudge: 1,
        turns_after_nudge: 0,
      },
      links: EAnalyticsLinks.Hashed,
    })
    expect(completedOf(captured)?.properties).toMatchObject({ status: 'completed' })
  })
})
