import { describe, expect, it } from 'bun:test'

import { inAppNoticeOf } from '../in-app'
import { ENotifyMoment } from '../moment'

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
