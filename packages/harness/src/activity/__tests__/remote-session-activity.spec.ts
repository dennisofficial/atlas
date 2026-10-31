import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { ECapability, EClientRequest } from '../../cloud/channel-wire'
import type { RemoteDeltaChannel } from '../../cloud/remote-delta-channel'
import { RemoteSessionActivity } from '../remote-session-activity'

const threadId = toThreadId('root')
const snapshot = {
  runtimeId: 'runtime-1',
  revision: 3,
  turnEpoch: 1,
  working: false,
  awaiting: null,
  observedOutcome: null,
}

type Channel = Pick<RemoteDeltaChannel, 'capabilities' | 'requestIfConnected'>

const fixture = (args: { supported?: boolean; request?: Channel['requestIfConnected'] } = {}) => {
  const calls: { op: EClientRequest; params: unknown }[] = []
  const channel: Channel = {
    capabilities: () => new Set(args.supported === false ? [] : [ECapability.ReadActivity]),
    requestIfConnected:
      args.request ??
      ((request) => {
        calls.push(request)
        return Promise.resolve(snapshot)
      }),
  }
  return { calls, activity: new RemoteSessionActivity({ channel }) }
}

describe('RemoteSessionActivity', () => {
  it('reads a complete snapshot only through the connected-only request seam', async () => {
    const test = fixture()
    expect(await test.activity.read({ threadId })).toEqual(snapshot)
    expect(test.calls).toEqual([{ op: EClientRequest.ReadActivity, params: { threadId } }])
  })

  it('makes disconnect, refusal and malformed replies unavailable rather than idle', async () => {
    const disconnected = fixture({ request: () => undefined })
    await expect(disconnected.activity.read({ threadId })).rejects.toThrow('disconnected')
    const refused = fixture({ request: () => Promise.reject(new Error('refused')) })
    await expect(refused.activity.read({ threadId })).rejects.toThrow('refused')
    const malformed = fixture({ request: () => Promise.resolve({ working: false }) })
    await expect(malformed.activity.read({ threadId })).rejects.toThrow()
    const missing = new RemoteSessionActivity({
      channel: {
        capabilities: () => new Set([ECapability.ReadActivity]),
      },
    })
    await expect(missing.read({ threadId })).rejects.toThrow('disconnected')
  })

  it('refuses an old peer before sending any request', async () => {
    const test = fixture({ supported: false })
    await expect(test.activity.read({ threadId })).rejects.toThrow('does not support')
    expect(test.calls).toEqual([])
  })
})
