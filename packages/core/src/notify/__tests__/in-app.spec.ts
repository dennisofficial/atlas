import { describe, expect, it } from 'bun:test'

import { inAppDueOf, inAppNoticeOf } from '../in-app'
import { ENotifyMoment } from '../moment'
import { EPendingWork } from '../pending-work'

const NOW = '2026-11-23T14:02:00.000Z'

const notice = (overrides: Partial<Parameters<typeof inAppNoticeOf>[0]> = {}) =>
  inAppNoticeOf({
    moment: ENotifyMoment.TurnFinished,
    sessionId: 'session-1',
    sessionTitle: 'Fix the renderer',
    seq: 12,
    readSeq: 11,
    onScreen: false,
    focused: true,
    enabled: true,
    now: NOW,
    ...overrides,
  })

describe('inAppNoticeOf', () => {
  it('draws a notice for a focused window in another session', () => {
    expect(notice()).toEqual({
      sessionId: 'session-1',
      seq: 12,
      moment: ENotifyMoment.TurnFinished,
      title: 'Fix the renderer',
      body: 'Finished',
      at: NOW,
    })
  })

  it('stays silent when the moment is off', () => {
    expect(notice({ enabled: false })).toBeNull()
  })

  it('stays silent when the window is not focused', () => {
    expect(notice({ focused: false })).toBeNull()
  })

  it('stays silent when the session is on screen', () => {
    expect(notice({ onScreen: true })).toBeNull()
  })

  it('stays silent when the notice is already read', () => {
    expect(notice({ readSeq: 12 })).toBeNull()
    expect(notice({ readSeq: 40 })).toBeNull()
  })

  it('draws a notice when nothing has been read', () => {
    expect(notice({ readSeq: null })?.seq).toBe(12)
  })

  it('uses the words of the moment', () => {
    expect(notice({ moment: ENotifyMoment.TurnFailed })?.body).toBe(
      'Failed — open Atlas to see why',
    )
    expect(notice({ moment: ENotifyMoment.WaitingForYou })?.body).toBe('Atlas needs you')
  })

  it('falls back to Atlas when the session has no title', () => {
    expect(notice({ sessionTitle: null })?.title).toBe('Atlas')
  })
})

describe('inAppDueOf', () => {
  const AT = '2026-11-23T14:00:00.000Z'

  const due = (args: Partial<Parameters<typeof inAppDueOf>[0]> = {}) =>
    inAppDueOf({
      moment: ENotifyMoment.TurnFinished,
      lastTurn: {
        at: AT,
        notify: { pending: [EPendingWork.Shell], operatorTurn: true },
      },
      nested: false,
      ...args,
    })

  it('shows a moment that is not a finished turn', () => {
    expect(due({ moment: ENotifyMoment.TurnFailed })).toEqual({ show: true })
    expect(due({ moment: ENotifyMoment.WaitingForYou })).toEqual({ show: true })
  })

  it('shows a finished turn the server sent no notify facts for', () => {
    expect(due({ lastTurn: { at: AT } })).toEqual({ show: true })
    expect(due({ lastTurn: null })).toEqual({ show: true })
  })

  it('shows a finished turn with no pending work', () => {
    expect(due({ lastTurn: { at: AT, notify: { pending: [], operatorTurn: true } } })).toEqual({
      show: true,
    })
  })

  it('holds a finished turn for the hold of its pending work', () => {
    expect(due()).toEqual({ dueAt: '2026-11-23T15:00:00.000Z' })
    expect(
      due({
        lastTurn: { at: AT, notify: { pending: [EPendingWork.Subscription], operatorTurn: true } },
      }),
    ).toEqual({ dueAt: '2026-11-23T14:10:00.000Z' })
    expect(
      due({
        lastTurn: {
          at: AT,
          notify: { pending: [EPendingWork.Agent, EPendingWork.Shell], operatorTurn: true },
        },
      }),
    ).toEqual({ dueAt: '2026-11-23T15:00:00.000Z' })
  })

  it('never shows a nested agent turn', () => {
    expect(
      due({
        nested: true,
        lastTurn: { at: AT, notify: { pending: [], operatorTurn: false } },
      }),
    ).toEqual({ show: false })
    expect(
      due({
        nested: true,
        lastTurn: { at: AT, notify: { pending: [EPendingWork.Shell], operatorTurn: false } },
      }),
    ).toEqual({ show: false })
  })

  it('shows a nested turn the operator caused', () => {
    expect(
      due({ nested: true, lastTurn: { at: AT, notify: { pending: [], operatorTurn: true } } }),
    ).toEqual({ show: true })
  })

  it('shows the turn when the row has no time to hold from', () => {
    expect(
      due({ lastTurn: { notify: { pending: [EPendingWork.Shell], operatorTurn: true } } }),
    ).toEqual({ show: true })
    expect(
      due({
        lastTurn: {
          at: 'not a time',
          notify: { pending: [EPendingWork.Shell], operatorTurn: true },
        },
      }),
    ).toEqual({ show: true })
  })
})
