import { describe, expect, it } from 'bun:test'
import { ERuntimePhase } from '@dltech/atlas-wire'

import { EClientFrame, EClientRequest, EServeFrame } from '../channel-wire'
import { EConnectionView } from '../connection-view'
import { RemoteRequestLost } from '../remote-delta-channel'
import { checkpointOf, harness, readied } from './remote-channel-fixture'

const WOKEN = { url: 'https://woken.test/', token: 'tok_woken' }

const retryUntilExhausted = (test: ReturnType<typeof harness>): number => {
  let retried = 0
  while (test.retries.length > retried) {
    test.retries[retried]?.run()
    retried += 1
    test.drop()
  }
  return retried
}

describe('the one recovery ladder', () => {
  it('backs off five times, then reads Disconnected with the attempts in its detail', () => {
    const test = readied()
    test.drop()
    expect(test.channel.connection().state).toBe(EConnectionView.Reconnecting)

    expect(retryUntilExhausted(test)).toBe(5)
    expect(test.channel.connection()).toEqual({
      state: EConnectionView.Disconnected,
      detail: 'The session socket closed and did not reopen after 5 attempts.',
    })
  })

  it('fails waiting requests once the retries are spent, rather than at their timeout', async () => {
    const test = readied({ maxAttempts: 0, requestTimeoutMs: 60_000 })
    const answer = test.channel.request({ op: EClientRequest.ReadEvents, params: {} }).catch((error: unknown) => error)
    test.drop()

    expect(await answer).toBeInstanceOf(RemoteRequestLost)
  })

  it('gives an Updating serve ten attempts, since the swap downloads a binary', () => {
    const test = readied()
    test.receive({ kind: EServeFrame.Checkpoint, checkpoint: checkpointOf({ phase: ERuntimePhase.Updating, revision: 2 }) })
    expect(test.channel.connection().state).toBe(EConnectionView.Connected)

    test.drop()
    expect(test.channel.connection().state).toBe(EConnectionView.Updating)
    expect(retryUntilExhausted(test)).toBe(10)
    expect(test.channel.connection().detail).toContain('after 10 attempts')
  })

  it('never retries a socket the serve closed behind a Parked frame', () => {
    const test = readied()
    test.receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    test.drop()

    expect(test.channel.connection().state).toBe(EConnectionView.Parked)
    expect(test.retries).toEqual([])
  })
})

describe('waking a parked sandbox on send', () => {
  it('wakes once, reads Waking, and delivers the queued sends after the fresh serve greets', async () => {
    let wakes = 0
    const test = readied({
      wakeSandbox: async () => {
        wakes += 1
        return WOKEN
      },
    })
    test.receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    test.drop()

    test.channel.send({ text: 'are you there' })
    test.channel.send({ text: 'still there?' })
    expect(test.channel.connection().state).toBe(EConnectionView.Waking)
    await Bun.sleep(1)

    expect(wakes).toBe(1)
    expect(test.live().url).toBe('wss://woken.test/v1/session')
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })

    expect(test.channel.connection().state).toBe(EConnectionView.Connected)
    const sends = test.live().sent.filter((frame) => frame.kind === EClientFrame.Send)
    expect(sends.map((frame) => (frame.kind === EClientFrame.Send ? frame.text : ''))).toEqual(['are you there', 'still there?'])
    expect(test.channel.unackedSendCount()).toBe(2)
  })

  it('reads Disconnected with the cause when the wake fails, says so once, and does not retry', async () => {
    let wakes = 0
    const test = readied({
      requestTimeoutMs: 60_000,
      wakeSandbox: async () => {
        wakes += 1
        throw new Error('the provider refused')
      },
    })
    const failures: string[] = []
    test.channel.onError((failure) => void failures.push(failure.message))
    test.receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    test.drop()

    const answer = test.channel.request({ op: EClientRequest.ReadEvents, params: {} }).catch((error: unknown) => error)
    await Bun.sleep(1)

    expect(test.channel.connection()).toEqual({
      state: EConnectionView.Disconnected,
      detail: 'the sandbox could not be woken: the provider refused',
    })
    expect(failures).toEqual(['the sandbox could not be woken: the provider refused'])
    expect(await answer).toBeInstanceOf(RemoteRequestLost)
    expect(wakes).toBe(1)
    expect(test.retries).toEqual([])
  })

  it('wakes from Disconnected on a manual reconnect, with nothing to ask first', async () => {
    let wakes = 0
    const test = readied({
      maxAttempts: 0,
      wakeSandbox: async () => {
        wakes += 1
        return WOKEN
      },
    })
    test.drop()
    expect(test.channel.connection().state).toBe(EConnectionView.Disconnected)

    test.channel.reconnect()
    expect(test.channel.connection().state).toBe(EConnectionView.Waking)
    await Bun.sleep(1)

    expect(wakes).toBe(1)
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })
    expect(test.channel.connection().state).toBe(EConnectionView.Connected)
  })
})

describe('a lifecycle record read out of band', () => {
  it('keeps an unattached channel Parked on a Serving record, and ignores an older revision', () => {
    const test = harness({ unattached: true })

    test.channel.observeCheckpoint(checkpointOf({ phase: ERuntimePhase.Serving, revision: 2 }))
    expect(test.channel.connection().state).toBe(EConnectionView.Parked)

    test.channel.observeCheckpoint(checkpointOf({ phase: ERuntimePhase.Waking, revision: 1 }))
    expect(test.channel.connection().state).toBe(EConnectionView.Parked)
    expect(test.channel.checkpoint?.()?.revision).toBe(2)
  })

  it('reads Waking once the record says the sandbox is waking, and tells listeners', () => {
    const test = harness({ unattached: true })
    const seen: EConnectionView[] = []
    test.channel.onConnection((view) => void seen.push(view.state))

    test.channel.observeCheckpoint(checkpointOf({ phase: ERuntimePhase.Waking, revision: 3 }))

    expect(test.channel.connection().state).toBe(EConnectionView.Waking)
    expect(seen).toEqual([EConnectionView.Waking])
  })

  it('ignores a record for another thread', () => {
    const test = harness({ unattached: true })

    test.channel.observeCheckpoint(checkpointOf({ phase: ERuntimePhase.Waking, revision: 3, threadId: 'brn_other' }))

    expect(test.channel.connection().state).toBe(EConnectionView.Parked)
    expect(test.channel.checkpoint?.()).toBeNull()
  })
})
