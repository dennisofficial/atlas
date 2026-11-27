import { describe, expect, it } from 'bun:test'

import {
  EQualityFindingState,
  EQualityTransition,
  toCallId,
  type CodeQualityReviewedBody,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { reviewIdOf } from '../analytics/review-links'
import { nudgeReactionProperties } from '../analytics/reaction-properties'
import type { QualityReviewEventProperties } from '../analytics/review-properties'
import {
  briefSaid,
  eventsOf,
  notified,
  resolved,
  reviewed,
  retired,
  said,
  turnStarted,
  wakeConsumed,
} from './finding-fixtures'
import { CALL, THREAD } from './support'

const REPLY = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const kept = (): CodeQualityReviewedBody =>
  reviewed({
    state: EQualityFindingState.Active,
    notified: true,
    transition: EQualityTransition.None,
  })

const withConcern = (args: {
  record: CodeQualityReviewedBody
  concern: number | null
}): CodeQualityReviewedBody => ({
  ...args.record,
  assessments: args.record.assessments.map((assessment) => ({
    ...assessment,
    currentConcernProbability: args.concern,
  })),
})

const episode = (args: { episode: number }): CodeQualityReviewedBody => ({
  ...notified(),
  findings: notified().findings.map((finding) => ({
    ...finding,
    id: `single-responsibility:scope-1:${args.episode}`,
    episode: args.episode,
  })),
})

const REACTION_ID1 = 'single-responsibility:scope-1:1'

const reactions = (events: readonly RecordEventBody[]): readonly QualityReviewEventProperties[] =>
  nudgeReactionProperties({ events: eventsOf(events), threadId: THREAD })

describe('nudgeReactionProperties', () => {
  it('reports an untouched finding with its links and its counts', () => {
    expect(reactions([turnStarted, notified(), said])).toEqual([
      {
        review_id: reviewIdOf({ callId: CALL }),
        finding_id: REACTION_ID1,
        episode: 1,
        policy_id: 'single-responsibility',
        nudge_kind: 'new',
        reaction: 'untouched',
        mentioned_in_reply: false,
        concern_at_nudge: 0.9,
        concern_at_end: 0.9,
        steps_after_nudge: 1,
        turns_after_nudge: 0,
      },
    ])
  })

  it('names the kind of the nudge the finding was notified with', () => {
    const debt = reviewed({
      state: EQualityFindingState.Active,
      notified: true,
      transition: EQualityTransition.TrackDebt,
    })

    expect(reactions([turnStarted, debt, said])[0]).toMatchObject({ nudge_kind: 'debt' })
  })

  it('reports fixed when a later review in the turn resolved the finding', () => {
    expect(reactions([turnStarted, notified(), said, resolved()])[0]).toMatchObject({
      reaction: 'fixed',
    })
  })

  it('reports fixed when a later write removed the scope', () => {
    expect(reactions([turnStarted, notified(), said, retired()])[0]).toMatchObject({
      reaction: 'fixed',
    })
  })

  it('reports edited_still_flagged when a later review assessed the scope and kept it', () => {
    expect(reactions([turnStarted, notified(), said, kept()])[0]).toMatchObject({
      reaction: 'edited_still_flagged',
    })
  })

  it('reports the concern of the last assessment of the scope in the turn', () => {
    const later = withConcern({ record: kept(), concern: 0.4 })

    expect(reactions([turnStarted, notified(), said, later])[0]).toMatchObject({
      concern_at_nudge: 0.9,
      concern_at_end: 0.4,
    })
  })

  it('derives the review id from the tool call of the notified record', () => {
    const otherCall = { ...notified(), callId: toCallId('call-2') }

    expect(reactions([turnStarted, otherCall, said])[0]).toMatchObject({
      review_id: reviewIdOf({ callId: toCallId('call-2') }),
    })
  })

  it('reports an empty list for a thread with no turn start', () => {
    expect(reactions([notified(), said])).toEqual([])
  })

  describe('mentioned_in_reply', () => {
    it('is true when the agent names the scope', () => {
      expect(
        reactions([turnStarted, notified(), REPLY('The Widget class is split now')])[0],
      ).toMatchObject({ mentioned_in_reply: true })
    })

    it('is true when the agent names the policy title, whatever its case', () => {
      expect(
        reactions([turnStarted, notified(), REPLY('single RESPONSIBILITY looks fine here')])[0],
      ).toMatchObject({ mentioned_in_reply: true })
    })

    it('is false when the agent says something else', () => {
      expect(reactions([turnStarted, notified(), REPLY('done')])[0]).toMatchObject({
        mentioned_in_reply: false,
      })
    })

    it('ignores text the agent wrote before the nudge', () => {
      const events = [turnStarted, REPLY('Widget is ready'), notified(), said]

      expect(reactions(events)[0]).toMatchObject({ mentioned_in_reply: false })
    })
  })

  describe('dedupe', () => {
    it('reports one finding once across the writes of a turn', () => {
      expect(reactions([turnStarted, notified(), said, kept(), said])).toHaveLength(1)
    })

    it('reports nothing at the end of a turn that only re-records an earlier nudge', () => {
      const laterTurn = [turnStarted, notified(), said, turnStarted, notified(), said]

      expect(reactions(laterTurn)).toEqual([])
    })

    it('reports a reintroduced finding as its own episode', () => {
      const properties = reactions([
        turnStarted,
        notified(),
        resolved(),
        episode({ episode: 2 }),
        said,
      ])

      expect(properties.map((held) => [held['episode'], held['reaction']])).toEqual([
        [1, 'fixed'],
        [2, 'untouched'],
      ])
    })
  })

  describe('in a sub-agent thread, which records no turn-started', () => {
    it('reports an untouched finding of the run', () => {
      expect(reactions([briefSaid, notified(), said])[0]).toMatchObject({
        reaction: 'untouched',
        steps_after_nudge: 1,
      })
    })

    it('reports fixed when the run resolved the finding', () => {
      expect(reactions([briefSaid, notified(), said, resolved()])[0]).toMatchObject({
        reaction: 'fixed',
      })
    })

    it('reports nothing at the end of a run woken by a later input', () => {
      expect(reactions([briefSaid, notified(), said, wakeConsumed, said])).toEqual([])
    })
  })
})
