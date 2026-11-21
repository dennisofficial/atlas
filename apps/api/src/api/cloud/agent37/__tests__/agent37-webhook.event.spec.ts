import { describe, expect, it } from 'bun:test'
import { ESandboxStatus } from '@dltech/atlas-protocol'

import { agent37StatusEventOf } from '../agent37-webhook.event'

const AT = '2026-11-21T09:30:00.123Z'

const eventOf = (data: Record<string, unknown> = {}): unknown => ({
  type: 'instance.status.updated',
  timestamp: AT,
  data: { id: 'ab12cd34ef', status: 'sleeping', ...data },
})

describe('agent37StatusEventOf', () => {
  it('reads the status the instance declared', () => {
    expect(agent37StatusEventOf(eventOf())).toEqual({
      instanceId: 'ab12cd34ef',
      status: ESandboxStatus.Sleeping,
      at: AT,
    })
  })

  it('keeps the message of a declared status reason', () => {
    expect(
      agent37StatusEventOf(eventOf({ status_reason: { code: 'idle', message: 'idle timeout' } })),
    ).toEqual({
      instanceId: 'ab12cd34ef',
      status: ESandboxStatus.Sleeping,
      reason: 'idle timeout',
      at: AT,
    })
  })

  it('drops a reason without a message', () => {
    expect(
      agent37StatusEventOf(eventOf({ status_reason: { code: 'idle' } }))?.reason,
    ).toBeUndefined()
    expect(agent37StatusEventOf(eventOf({ status_reason: null }))?.reason).toBeUndefined()
  })

  it('ignores another event type', () => {
    expect(agent37StatusEventOf({ ...(eventOf() as object), type: 'instance.created' })).toBeNull()
  })

  it('ignores a status the protocol does not know', () => {
    expect(agent37StatusEventOf(eventOf({ status: 'hibernating' }))).toBeNull()
  })

  it('ignores a timestamp it cannot read', () => {
    expect(
      agent37StatusEventOf({ ...(eventOf() as object), timestamp: 'not-a-timestamp' }),
    ).toBeNull()
  })
})
