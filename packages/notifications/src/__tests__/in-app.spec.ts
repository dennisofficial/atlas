import { describe, expect, it } from 'bun:test'

import {
  ENotifyMoment,
  ESessionStatus,
  ETurnEndedBy,
  ETurnOutcome,
  notificationCopyOf,
} from '@dltech/atlas-core'

import { type InAppRow, inAppMomentsOf, inAppNoticesOf, inAppRowOf } from '../client/in-app'
import { staleNoticeIdsOf } from '../client/clear'

const NOW = '2026-11-23T10:00:00.000Z'

const rowOf = (overrides: Partial<InAppRow> = {}): InAppRow => ({
  sessionId: 's-1',
  title: 'Fix the sidebar',
  status: ESessionStatus.Idle,
  readSeq: null,
  headSeq: 9,
  lastTurn: { seq: 9, outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent },
  ...overrides,
})

const mapOf = (...rows: readonly InAppRow[]): ReadonlyMap<string, InAppRow> =>
  new Map(rows.map((row) => [row.sessionId, row]))

const noticesOf = (args: {
  previous: ReadonlyMap<string, InAppRow> | null
  next: readonly InAppRow[]
  openSessionId?: string | null
  focused?: boolean
}) =>
  inAppNoticesOf({
    previous: args.previous,
    next: args.next,
    openSessionId: args.openSessionId ?? null,
    focused: args.focused ?? true,
    enabled: () => true,
    now: NOW,
  })

const finishedRow = rowOf({ lastTurn: null })

describe('inAppMomentsOf', () => {
  it('says nothing for the first snapshot', () => {
    expect(inAppMomentsOf({ previous: null, next: [rowOf()] })).toEqual([])
  })

  it('says nothing for a row it has not seen before', () => {
    const previous = mapOf(rowOf({ sessionId: 'other' }))
    expect(inAppMomentsOf({ previous, next: [rowOf()] })).toEqual([])
  })

  it('reports a finished turn when the ending is newer', () => {
    const previous = mapOf(finishedRow)
    expect(inAppMomentsOf({ previous, next: [rowOf()] })).toEqual([
      { row: rowOf(), moment: ENotifyMoment.TurnFinished, seq: 9 },
    ])
  })

  it('says nothing while the ending is the same', () => {
    const previous = mapOf(rowOf())
    expect(inAppMomentsOf({ previous, next: [rowOf()] })).toEqual([])
  })

  it('reports a failed turn', () => {
    const failed = rowOf({
      lastTurn: { seq: 4, outcome: ETurnOutcome.Failed, by: ETurnEndedBy.Agent },
    })
    expect(inAppMomentsOf({ previous: mapOf(finishedRow), next: [failed] })).toEqual([
      { row: failed, moment: ENotifyMoment.TurnFailed, seq: 4 },
    ])
  })

  it('says nothing for a turn the operator stopped', () => {
    const stopped = rowOf({
      lastTurn: { seq: 4, outcome: ETurnOutcome.Stopped, by: ETurnEndedBy.Operator },
    })
    expect(inAppMomentsOf({ previous: mapOf(finishedRow), next: [stopped] })).toEqual([])
  })

  it('reports a waiting status once, at the head seq', () => {
    const waiting = rowOf({
      status: ESessionStatus.WaitingForOperator,
      headSeq: 12,
      lastTurn: null,
    })
    const thinking = rowOf({ status: ESessionStatus.Thinking, lastTurn: null })
    expect(inAppMomentsOf({ previous: mapOf(thinking), next: [waiting] })).toEqual([
      { row: waiting, moment: ENotifyMoment.WaitingForYou, seq: 12 },
    ])
    expect(inAppMomentsOf({ previous: mapOf(waiting), next: [waiting] })).toEqual([])
  })
})

describe('inAppNoticesOf', () => {
  it('builds the notice from the copy and the moment', () => {
    expect(noticesOf({ previous: mapOf(finishedRow), next: [rowOf()] })).toEqual([
      {
        sessionId: 's-1',
        seq: 9,
        moment: ENotifyMoment.TurnFinished,
        ...notificationCopyOf({ moment: ENotifyMoment.TurnFinished, sessionTitle: rowOf().title }),
        at: NOW,
      },
    ])
  })

  it('says nothing for the session that is on screen', () => {
    expect(
      noticesOf({ previous: mapOf(finishedRow), next: [rowOf()], openSessionId: 's-1' }),
    ).toEqual([])
  })

  it('says nothing while the window is not focused', () => {
    expect(noticesOf({ previous: mapOf(finishedRow), next: [rowOf()], focused: false })).toEqual([])
  })

  it('says nothing when the moment is off', () => {
    const notices = inAppNoticesOf({
      previous: mapOf(finishedRow),
      next: [rowOf()],
      openSessionId: null,
      focused: true,
      enabled: () => false,
      now: NOW,
    })
    expect(notices).toEqual([])
  })

  it('says nothing when the read marker already covers the moment', () => {
    expect(noticesOf({ previous: mapOf(finishedRow), next: [rowOf({ readSeq: 9 })] })).toEqual([])
  })
})

describe('inAppRowOf', () => {
  it('reads the summary the sessions list sends', () => {
    expect(
      inAppRowOf({
        sessionId: 's-1',
        title: null,
        status: { state: ESessionStatus.WaitingForCredentials },
        readSeq: 3,
        headSeq: 7,
        lastTurn: { seq: 6, outcome: ETurnOutcome.Interrupted, by: ETurnEndedBy.Host },
      }),
    ).toEqual({
      sessionId: 's-1',
      title: null,
      status: ESessionStatus.WaitingForCredentials,
      readSeq: 3,
      headSeq: 7,
      lastTurn: { seq: 6, outcome: ETurnOutcome.Interrupted, by: ETurnEndedBy.Host },
    })
  })

  it('reads a summary from an older server', () => {
    expect(inAppRowOf({ sessionId: 's-1', title: 'Hi' })).toEqual({
      sessionId: 's-1',
      title: 'Hi',
      status: null,
      readSeq: null,
      headSeq: null,
      lastTurn: null,
    })
  })
})

describe('staleNoticeIdsOf', () => {
  const notice = {
    sessionId: 's-1',
    seq: 9,
    moment: ENotifyMoment.TurnFinished,
    title: 'Fix the sidebar',
    body: 'Finished',
    at: NOW,
  }

  it('drops the notice of the session that opens', () => {
    expect(
      staleNoticeIdsOf({ notices: [notice], rows: mapOf(rowOf()), openSessionId: 's-1' }),
    ).toEqual(['s-1'])
  })

  it('drops the notice once the read marker reaches it', () => {
    expect(
      staleNoticeIdsOf({
        notices: [notice],
        rows: mapOf(rowOf({ readSeq: 9 })),
        openSessionId: null,
      }),
    ).toEqual(['s-1'])
  })

  it('keeps a notice the read marker has not reached', () => {
    expect(
      staleNoticeIdsOf({
        notices: [notice],
        rows: mapOf(rowOf({ readSeq: 8 })),
        openSessionId: 'other',
      }),
    ).toEqual([])
  })
})
