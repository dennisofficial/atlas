import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame } from '../channel-wire'
import { PASSIVE_REQUESTS } from '../passive-requests'
import { RemoteRequestLost } from '../remote-delta-channel'
import { harness, readied, THREAD } from './remote-channel-fixture'

const read = { op: EClientRequest.ReadActivity, params: { threadId: THREAD } }

describe('passive activity requests', () => {
  it('classifies activity as a passive read', () => {
    expect(PASSIVE_REQUESTS.has(EClientRequest.ReadActivity)).toBe(true)
  })

  it('never queues or wakes before Connected, including during Ready notification', () => {
    let wakes = 0
    const test = harness({
      wakeSandbox: async () => {
        wakes += 1
        return { url: 'https://sandbox.test/', token: 'token' }
      },
    })
    expect(test.channel.requestIfConnected?.(read)).toBeUndefined()
    test.open()
    expect(test.channel.requestIfConnected?.(read)).toBeUndefined()
    test.channel.onReady(() => {
      expect(test.channel.requestIfConnected?.(read)).toBeUndefined()
    })
    test.receive({ kind: EServeFrame.Ready, seq: 1 })
    expect(test.live().sent.filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])
    expect(wakes).toBe(0)
    test.channel.close()
  })

  it('refuses an in-flight read on disconnect and never replays it', async () => {
    const test = readied()
    const reply = test.channel.requestIfConnected?.(read)
    expect(reply).toBeInstanceOf(Promise)
    test.drop()
    await expect(reply).rejects.toBeInstanceOf(RemoteRequestLost)
    expect(test.channel.requestIfConnected?.(read)).toBeUndefined()
    test.retries[0]?.run()
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 2 })
    expect(test.live().sent.filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])
    test.channel.close()
  })
})
