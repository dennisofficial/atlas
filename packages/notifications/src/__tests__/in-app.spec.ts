import { describe, expect, it } from 'bun:test'

import {
  EPendingWork,
  ENotifyMoment,
  ESessionStatus,
  ETurnEndedBy,
  ETurnOutcome,
  notificationCopyOf,
} from '@dltech/atlas-core'

import {
  dueDelayMs,
  dueNoticesOf,
  earliestDueAt,
  type HeldNotice,
  type InAppRow,
  inAppRowOf,
  inAppScanOf,
} from '../client/in-app'
import { staleNoticeIdsOf } from '../client/clear'

const AT = '2026-11-23T10:00:00.000Z'
const NOW = '2026-11-23T10:00:30.000Z'
const DUE = '2026-11-23T11:00:00.000Z'
const LATER = '2026-11-23T12:00:00.000Z'

const rowOf = (overrides: Partial<InAppRow> = {}): InAppRow => ({
  sessionId: 's-1',
  title: 'Fix the sidebar',
  status: ESessionStatus.Idle,
  readSeq: null,
  headSeq: 9,
  nested: false,
  lastTurn: { seq: 9, outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent },
  ...overrides,
})

const mapOf = (...rows: readonly InAppRow[]): ReadonlyMap<string, InAppRow> =>
  new Map(rows.map((row) => [row.sessionId, row]))

const HELD_ROW = rowOf({
  lastTurn: {
    seq: 9,
    outcome: ETurnOutcome.Completed,
    by: ETurnEndedBy.Agent,
    at: AT,
    notify: { pending: [EPendingWork.Shell], operatorTurn: false },
  },
})

const BEFORE = rowOf({ lastTurn: null })

const scanOf = (args: {
  previous: ReadonlyMap<string, InAppRow> | null
  next: readonly InAppRow[]
  held?: readonly HeldNotice[]
  openSessionId?: string | null
  focused?: boolean
  enabled?: (moment: ENotifyMoment) => boolean
  now?: string
}) =>
  inAppScanOf({
    previous: args.previous,
    next: args.next,
    held: args.held ?? [],
    openSessionId: args.openSessionId ?? null,
    focused: args.focused ?? true,
    enabled: args.enabled ?? (() => true),
    now: args.now ?? NOW,
  })

describe('inAppScanOf', () => {
  it('says nothing for the first snapshot', () => {
    expect(scanOf({ previous: null, next: [rowOf()] }).notices).toEqual([])
  })

  it('says nothing for a row it has not seen before', () => {
    const previous = mapOf(rowOf({ sessionId: 'other' }))
    expect(scanOf({ previous, next: [rowOf()] }).notices).toEqual([])
  })

  it('reports a finished turn when the ending is newer', () => {
    const notice = scanOf({ previous: mapOf(BEFORE), next: [rowOf()] }).notices
    expect(notice).toEqual([
      {
        sessionId: 's-1',
        seq: 9,
        moment: ENotifyMoment.TurnFinished,
        ...notificationCopyOf({ moment: ENotifyMoment.TurnFinished, sessionTitle: rowOf().title }),
        at: NOW,
      },
    ])
  })

  it('says nothing while the ending is the same', () => {
    expect(scanOf({ previous: mapOf(rowOf()), next: [rowOf()] }).notices).toEqual([])
  })

  it('reports a failed turn', () => {
    const failed = rowOf({
      lastTurn: { seq: 4, outcome: ETurnOutcome.Failed, by: ETurnEndedBy.Agent },
    })
    const notices = scanOf({ previous: mapOf(BEFORE), next: [failed] }).notices
    expect(notices.map((notice) => notice.moment)).toEqual([ENotifyMoment.TurnFailed])
  })

  it('says nothing for a turn the operator stopped', () => {
    const stopped = rowOf({
      lastTurn: { seq: 4, outcome: ETurnOutcome.Stopped, by: ETurnEndedBy.Operator },
    })
    expect(scanOf({ previous: mapOf(BEFORE), next: [stopped] }).notices).toEqual([])
  })

  it('reports a waiting status once, at the head seq', () => {
    const waiting = rowOf({
      status: ESessionStatus.WaitingForOperator,
      headSeq: 12,
      lastTurn: null,
    })
    const thinking = rowOf({ status: ESessionStatus.Thinking, lastTurn: null })
    expect(
      scanOf({ previous: mapOf(thinking), next: [waiting] }).notices.map((n) => n.seq),
    ).toEqual([12])
    expect(scanOf({ previous: mapOf(waiting), next: [waiting] }).notices).toEqual([])
  })

  it('says nothing for the session that is on screen', () => {
    expect(
      scanOf({ previous: mapOf(BEFORE), next: [rowOf()], openSessionId: 's-1' }).notices,
    ).toEqual([])
  })

  it('says nothing while the window is not focused', () => {
    expect(scanOf({ previous: mapOf(BEFORE), next: [rowOf()], focused: false }).notices).toEqual([])
  })

  it('says nothing when the moment is off', () => {
    const scan = scanOf({ previous: mapOf(BEFORE), next: [rowOf()], enabled: () => false })
    expect(scan.notices).toEqual([])
  })

  it('says nothing when the read marker already covers the moment', () => {
    expect(scanOf({ previous: mapOf(BEFORE), next: [rowOf({ readSeq: 9 })] }).notices).toEqual([])
  })

  it('shows a finished turn the server sent no notify facts for', () => {
    expect(scanOf({ previous: mapOf(BEFORE), next: [rowOf()] }).notices).toHaveLength(1)
  })

  it('never shows a nested agent turn', () => {
    const nested = rowOf({
      nested: true,
      lastTurn: {
        seq: 9,
        outcome: ETurnOutcome.Completed,
        by: ETurnEndedBy.Agent,
        at: AT,
        notify: { pending: [], operatorTurn: false },
      },
    })
    const scan = scanOf({ previous: mapOf(BEFORE), next: [nested] })
    expect(scan.notices).toEqual([])
    expect(scan.held).toEqual([])
  })

  it('shows a nested turn the operator caused', () => {
    const nested = rowOf({
      nested: true,
      lastTurn: {
        seq: 9,
        outcome: ETurnOutcome.Completed,
        by: ETurnEndedBy.Agent,
        at: AT,
        notify: { pending: [], operatorTurn: true },
      },
    })
    expect(scanOf({ previous: mapOf(BEFORE), next: [nested] }).notices).toHaveLength(1)
  })

  it('holds a finished turn while a shell is open', () => {
    const scan = scanOf({ previous: mapOf(BEFORE), next: [HELD_ROW] })
    expect(scan.notices).toEqual([])
    expect(scan.held).toEqual([{ sessionId: 's-1', seq: 9, dueAt: DUE }])
  })

  it('shows the held notice once the hold runs out', () => {
    const held = [{ sessionId: 's-1', seq: 9, dueAt: DUE }]
    const scan = scanOf({ previous: mapOf(HELD_ROW), next: [HELD_ROW], held, now: DUE })
    expect(scan.notices.map((notice) => notice.seq)).toEqual([9])
    expect(scan.held).toEqual([])
  })

  it('shows a turn that is already past its hold when it arrives', () => {
    const scan = scanOf({ previous: mapOf(BEFORE), next: [HELD_ROW], now: LATER })
    expect(scan.notices).toHaveLength(1)
    expect(scan.held).toEqual([])
  })
})

describe('dueNoticesOf', () => {
  const held = [{ sessionId: 's-1', seq: 9, dueAt: DUE }]

  it('keeps holding a notice whose time has not come', () => {
    expect(dueNoticesOf({ held, rows: [HELD_ROW], now: NOW })).toEqual({ moments: [], held })
  })

  it('releases the notice at its due time', () => {
    const due = dueNoticesOf({ held, rows: [HELD_ROW], now: DUE })
    expect(due.held).toEqual([])
    expect(due.moments.map((moment) => moment.seq)).toEqual([9])
  })

  it('drops the notice once a newer turn replaced it', () => {
    const newer = rowOf({
      lastTurn: { seq: 12, outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent },
    })
    expect(dueNoticesOf({ held, rows: [newer], now: DUE })).toEqual({ moments: [], held: [] })
  })

  it('drops the notice while the session runs again', () => {
    const running = rowOf({ status: ESessionStatus.RunningTool, lastTurn: HELD_ROW.lastTurn })
    expect(dueNoticesOf({ held, rows: [running], now: DUE })).toEqual({ moments: [], held: [] })
  })

  it('drops the notice when the row is gone', () => {
    expect(dueNoticesOf({ held, rows: [], now: DUE })).toEqual({ moments: [], held: [] })
  })
})

describe('earliestDueAt', () => {
  it('says nothing when nothing is held', () => {
    expect(earliestDueAt([])).toBeNull()
  })

  it('names the first due time', () => {
    expect(
      earliestDueAt([
        { sessionId: 's-1', seq: 9, dueAt: LATER },
        { sessionId: 's-2', seq: 4, dueAt: DUE },
      ]),
    ).toBe(DUE)
  })
})

describe('dueDelayMs', () => {
  it('never goes below zero', () => {
    expect(dueDelayMs({ dueAt: DUE, nowMs: Date.parse(LATER) })).toBe(0)
  })

  it('counts the wait in milliseconds', () => {
    expect(dueDelayMs({ dueAt: DUE, nowMs: Date.parse(AT) })).toBe(60 * 60_000)
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
        nested: true,
        spawnedBy: 's-0',
        lastTurn: {
          seq: 6,
          outcome: ETurnOutcome.Interrupted,
          by: ETurnEndedBy.Host,
          at: AT,
          notify: { pending: [EPendingWork.Agent], operatorTurn: true },
        },
      }),
    ).toEqual({
      sessionId: 's-1',
      title: null,
      status: ESessionStatus.WaitingForCredentials,
      readSeq: 3,
      headSeq: 7,
      nested: true,
      lastTurn: {
        seq: 6,
        outcome: ETurnOutcome.Interrupted,
        by: ETurnEndedBy.Host,
        at: AT,
        notify: { pending: [EPendingWork.Agent], operatorTurn: true },
      },
    })
  })

  it('reads a summary from an older server', () => {
    expect(inAppRowOf({ sessionId: 's-1', title: 'Hi' })).toEqual({
      sessionId: 's-1',
      title: 'Hi',
      status: null,
      readSeq: null,
      headSeq: null,
      nested: false,
      lastTurn: null,
    })
  })

  it('does not call a session nested without a spawner', () => {
    expect(inAppRowOf({ sessionId: 's-1', title: 'Hi', nested: true }).nested).toBe(false)
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
