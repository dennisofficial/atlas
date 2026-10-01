import { describe, expect, it } from 'bun:test'

import { EChannelConnection, EReconnectEscalation } from '../remote-delta-channel'
import { EServeFrame } from '../channel-wire'
import { harness } from './remote-channel-fixture'

const microtasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('transport recovery never wakes a parked sandbox', () => {
  it('ignores a parked lookup that resolves after a successful reconnect', async () => {
    let answer = (_verdict: EReconnectEscalation): void => undefined
    const verdict = new Promise<EReconnectEscalation>((resolve) => { answer = resolve })
    const test = harness({ lifecycleEscalation: () => verdict, reattach: async () => ({ url: 'https://new.test', token: 'new' }) })
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })
    test.drop()
    const retry = test.retries[0]
    if (retry === undefined) throw new Error('no socket retry was scheduled')
    retry.run()
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 2, turnInFlight: true })
    answer(EReconnectEscalation.Parked)
    await microtasks()
    expect(test.channel.connection().state).toBe(EChannelConnection.Open)
    test.channel.close()
  })

  it('marks a parked runtime without creating it when early lifecycle inspection finds park', async () => {
    let reattachments = 0
    const test = harness({
      lifecycleEscalation: async () => EReconnectEscalation.Parked,
      reattach: async () => { reattachments += 1; return { url: 'https://new.test', token: 'new' } },
    })
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })
    test.drop()
    await microtasks()
    expect(test.channel.connection().state).toBe(EChannelConnection.Parked)
    for (const retry of test.retries) retry.run()
    expect(test.sockets).toHaveLength(1)
    expect(reattachments).toBe(0)
    test.channel.close()
  })

  it('does not bypass park protection when the socket retry budget is exhausted', async () => {
    let reattachments = 0
    const test = harness({
      maxAttempts: 0,
      lifecycleEscalation: async () => EReconnectEscalation.Parked,
      reattach: async () => { reattachments += 1; return { url: 'https://new.test', token: 'new' } },
    })
    test.drop()
    await microtasks()
    expect(test.channel.connection().state).toBe(EChannelConnection.Parked)
    expect(reattachments).toBe(0)
    test.channel.reconnect()
    await microtasks()
    expect(reattachments).toBe(1)
    test.channel.close()
  })

  it('preserves unknown lifecycle without recreating a runtime after retry exhaustion', async () => {
    let reattachments = 0
    const test = harness({
      maxAttempts: 0,
      lifecycleEscalation: async () => EReconnectEscalation.Wait,
      reattach: async () => { reattachments += 1; return { url: 'https://new.test', token: 'new' } },
    })
    test.drop()
    await microtasks()
    expect(test.channel.connection().state).toBe(EChannelConnection.Closed)
    expect(reattachments).toBe(0)
    test.channel.close()
  })
})
