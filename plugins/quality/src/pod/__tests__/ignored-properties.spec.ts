import { describe, expect, it } from 'bun:test'

import { ignoredFindingProperties } from '../analytics/ignored-properties'
import {
  briefSaid,
  eventsOf,
  notified,
  resolved,
  said,
  turnStarted,
  wakeConsumed,
} from './finding-fixtures'
import { THREAD } from './support'

describe('ignoredFindingProperties', () => {
  it('reports a finding notified in the turn and still active at its end', () => {
    const events = eventsOf([turnStarted, notified(), said])

    expect(ignoredFindingProperties({ events, threadId: THREAD })).toEqual([
      { policy_id: 'single-responsibility', steps_after_nudge: 1, turns_after_nudge: 0 },
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

  describe('in a sub-agent thread, which records no turn-started', () => {
    it('reports a finding notified in the run and still active at its end', () => {
      const events = eventsOf([briefSaid, notified(), said])

      expect(ignoredFindingProperties({ events, threadId: THREAD })).toEqual([
        { policy_id: 'single-responsibility', steps_after_nudge: 1, turns_after_nudge: 0 },
      ])
    })

    it('says nothing when the finding was resolved before the run ended', () => {
      const events = eventsOf([briefSaid, notified(), said, resolved()])

      expect(ignoredFindingProperties({ events, threadId: THREAD })).toEqual([])
    })

    it('does not fire again at the end of a run woken by a later input', () => {
      const events = eventsOf([briefSaid, notified(), said, wakeConsumed, said])

      expect(ignoredFindingProperties({ events, threadId: THREAD })).toEqual([])
    })
  })
})
