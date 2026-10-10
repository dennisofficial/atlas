import { describe, expect, it } from 'bun:test'

import { EServeFrame } from '../channel-wire'
import { EChannelConnection } from '../remote-delta-channel'
import { harness } from './remote-channel-fixture'

const REFUSAL = 'this serve cannot confirm safe relocation preparation — the sandbox was preserved'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const parkedWithFailingReattach = (failure: () => Error, limit: number) => {
  let provisions = 0
  const test = harness({
    reattach: async () => {
      provisions += 1
      throw failure()
    },
    maxReattachments: limit,
  })
  test.open()
  test.receive({ kind: EServeFrame.Ready, seq: 1 })
  test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
  test.drop()
  return { ...test, provisions: () => provisions }
}

describe('a wake that keeps failing identically', () => {
  it('stops re-kicking after the same failure repeats and surfaces one actionable error', async () => {
    const test = parkedWithFailingReattach(() => new Error(REFUSAL), 3)
    const errors: string[] = []
    test.channel.onError((failure) => errors.push(failure.message))

    for (let attempt = 0; attempt < 5; attempt += 1) {
      test.channel.send({ text: `hello ${attempt}` })
      await settle()
      expect(test.channel.connection().state).toBe(EChannelConnection.Closed)
    }

    expect(test.provisions()).toBe(3)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('3 times in a row')
    expect(errors[0]).toContain(REFUSAL)
    expect(test.channel.connection().detail).toContain('Automatic retries have stopped')
  })

  it('holds the stop across further queued work until an explicit reconnect re-arms it', async () => {
    const test = parkedWithFailingReattach(() => new Error(REFUSAL), 2)

    test.channel.send({ text: 'one' })
    await settle()
    test.channel.send({ text: 'two' })
    await settle()
    expect(test.provisions()).toBe(2)

    test.channel.send({ text: 'three' })
    test.channel.send({ text: 'four' })
    await settle()
    expect(test.provisions()).toBe(2)

    test.channel.reconnect()
    await settle()
    expect(test.provisions()).toBe(3)
  })

  it('keeps kicking while the failure cause changes', async () => {
    const causes = ['first cause', 'second cause', 'third cause', 'fourth cause']
    let kicks = 0
    const test = harness({
      reattach: async () => {
        const cause = causes[kicks] ?? 'later cause'
        kicks += 1
        throw new Error(cause)
      },
      maxReattachments: 3,
    })
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })
    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    test.drop()

    for (const _ of causes) {
      test.channel.send({ text: 'hello' })
      await settle()
    }

    expect(kicks).toBe(4)
    expect(test.channel.connection().state).toBe(EChannelConnection.Closed)
  })

  it('forgets the repeat count once a wake attaches', async () => {
    let failures = 0
    let provisions = 0
    const test = harness({
      reattach: async () => {
        provisions += 1
        if (failures < 2) {
          failures += 1
          throw new Error(REFUSAL)
        }
        return { url: 'https://fresh.test/', token: 'tok_fresh' }
      },
      maxReattachments: 3,
    })
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })
    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    test.drop()

    test.channel.send({ text: 'one' })
    await settle()
    test.channel.send({ text: 'two' })
    await settle()
    test.channel.send({ text: 'three' })
    await settle()
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })

    expect(test.channel.connection().state).toBe(EChannelConnection.Open)
    expect(provisions).toBe(3)

    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    test.drop()
    const errors: string[] = []
    test.channel.onError((failure) => errors.push(failure.message))

    test.channel.send({ text: 'again' })
    await settle()
    test.open()
    test.receive({ kind: EServeFrame.Ready, seq: 1 })

    expect(provisions).toBe(4)
    expect(test.channel.connection().state).toBe(EChannelConnection.Open)
    expect(errors.some((message) => message.includes('Automatic retries have stopped'))).toBe(false)
  })
})
