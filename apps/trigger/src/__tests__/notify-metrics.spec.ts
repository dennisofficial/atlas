import { describe, expect, it } from 'bun:test'
import { ENotifyMoment } from '@dltech/atlas-core'

import { captureNotificationSent } from '../notify/notify-metrics'
import { expoDeviceOf, RecordingAnalytics } from './notify-graph.fake'

const PAYLOAD = {
  sessionId: 'session-1',
  threadId: 'thread-1',
  seq: 7,
  moment: ENotifyMoment.TurnFinished,
}

const sentPropertiesOf = (result: { sent: boolean; error?: string }) => {
  const analytics = new RecordingAnalytics()
  captureNotificationSent({
    analytics,
    userId: 'user-1',
    payload: PAYLOAD,
    devices: [expoDeviceOf()],
    results: [{ deviceId: expoDeviceOf().id, ...result }],
    sound: true,
    now: '2026-11-28T12:00:00.000Z',
  })
  return analytics.captured[0]?.properties
}

describe('captureNotificationSent', () => {
  it('names the error of a push the provider refused', () => {
    expect(sentPropertiesOf({ sent: false, error: 'UNAUTHORIZED' })).toMatchObject({
      accepted: false,
      error: 'UNAUTHORIZED',
    })
  })

  it('leaves the error out of an accepted push', () => {
    expect(sentPropertiesOf({ sent: true })).not.toHaveProperty('error')
  })
})
