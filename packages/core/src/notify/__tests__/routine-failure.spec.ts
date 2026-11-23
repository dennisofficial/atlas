import { describe, expect, it } from 'bun:test'

import { atlasNotificationSchema } from '../model'
import { ENotifyMoment } from '../moment'
import { routineFailureNotificationOf, type RoutineFailureFacts } from '../routine-failure'

const facts = (overrides: Partial<RoutineFailureFacts> = {}): RoutineFailureFacts => ({
  routineId: 'rtn-1',
  routineName: 'Monday L10 Meeting Prep',
  reason: 'failed: stored event t:20 is invalid',
  enabled: true,
  quiet: false,
  now: '2026-11-23T12:01:29.000Z',
  ...overrides,
})

describe('routineFailureNotificationOf', () => {
  it('names the routine and why its scheduled run did not start', () => {
    const notification = routineFailureNotificationOf(facts())
    expect(notification).toEqual({
      sessionId: 'routine-rtn-1',
      seq: 0,
      moment: ENotifyMoment.TurnFailed,
      title: 'Monday L10 Meeting Prep',
      body: 'Scheduled run did not start. failed: stored event t:20 is invalid',
      at: '2026-11-23T12:01:29.000Z',
      routineId: 'rtn-1',
    })
    expect(atlasNotificationSchema.safeParse(notification).success).toBe(true)
  })

  it('stays silent when failure pushes are off or in quiet hours', () => {
    expect(routineFailureNotificationOf(facts({ enabled: false }))).toBeNull()
    expect(routineFailureNotificationOf(facts({ quiet: true }))).toBeNull()
  })

  it('falls back to a title and caps the body', () => {
    const notification = routineFailureNotificationOf(
      facts({ routineName: '  ', reason: 'x'.repeat(500) }),
    )
    expect(notification?.title).toBe('Atlas routine')
    expect(notification?.body.length).toBe(200)
  })
})
