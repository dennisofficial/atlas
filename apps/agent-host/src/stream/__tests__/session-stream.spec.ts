import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { STREAM_PROTOCOL_VERSION, type StreamServerMessage } from '@dltech/atlas-protocol'

import { createSessionStream, SessionStreamLimitError } from '../session-stream'
import { createUserSlots } from '../user-slots'
import { FollowRig, OWNER, SESSION, THREAD } from './follow-rig'

const pull = async (
  generator: AsyncGenerator<StreamServerMessage>,
): Promise<StreamServerMessage> => {
  const step = await generator.next()
  if (step.done === true) throw new Error('the stream ended early')
  return step.value
}

const liveSeqs = async (generator: AsyncGenerator<StreamServerMessage>): Promise<number[]> => {
  for (;;) {
    const frame = await pull(generator)
    if (frame.type === 'events' && frame.live) return frame.events.map((event) => Number(event.seq))
  }
}

describe('session stream adapters', () => {
  let rig: FollowRig

  beforeEach(() => {
    rig = new FollowRig()
  })

  afterEach(() => {
    rig.dispose()
  })

  const streamOf = (args: { limit?: number; eventTypes?: readonly string[] } = {}) =>
    createSessionStream({
      subscriptions: () => rig.follow,
      users: createUserSlots({ limit: args.limit ?? 4 }),
      timers: rig.timers,
      eventTypes: args.eventTypes ?? ['user-said'],
      log: undefined,
    })

  it('greets with ready and resumes live after the requested cursor', async () => {
    await rig.seed({ events: 10 })
    const page = await rig.plane.readEvents({
      threadId: THREAD,
      afterSeq: 0,
      limit: 10,
      visible: false,
    })
    const generator = streamOf().follow({
      userId: OWNER,
      sessionId: SESSION,
      afterSeq: 5,
      afterHash: rig.hashAt(page.events, 5),
    })

    const ready = await pull(generator)
    expect(ready.type).toBe('ready')
    if (ready.type === 'ready') {
      expect(ready.v).toBe(STREAM_PROTOCOL_VERSION)
      expect(ready.eventTypes).toEqual(['user-said'])
    }
    expect(await liveSeqs(generator)).toEqual([6, 7, 8, 9, 10])
    await generator.return(undefined)
  })

  it('refuses a subscription past the per user slot limit until one is given back', async () => {
    await rig.seed({ events: 0 })
    const stream = streamOf({ limit: 1 })
    const first = stream.follow({ userId: OWNER, sessionId: SESSION })
    expect((await pull(first)).type).toBe('ready')

    const refused = stream.follow({ userId: OWNER, sessionId: SESSION })
    await expect(refused.next()).rejects.toBeInstanceOf(SessionStreamLimitError)

    await first.return(undefined)
    const third = stream.follow({ userId: OWNER, sessionId: SESSION })
    expect((await pull(third)).type).toBe('ready')
    await third.return(undefined)
  })

  it('ends a drained stream with going-away instead of waiting for a turn', async () => {
    await rig.seed({ events: 0 })
    const stream = streamOf()
    const generator = stream.follow({ userId: OWNER, sessionId: SESSION })
    expect((await pull(generator)).type).toBe('ready')

    stream.drain()
    const away = await pull(generator)
    expect(away.type).toBe('going-away')
    if (away.type === 'going-away') expect(away.reconnectAfterMs).toBeLessThanOrEqual(5_000)
    expect((await generator.next()).done).toBe(true)
  })

  it('releases the slot when the subscription is aborted', async () => {
    await rig.seed({ events: 0 })
    const stream = streamOf({ limit: 1 })
    const controller = new AbortController()
    const generator = stream.follow({
      userId: OWNER,
      sessionId: SESSION,
      signal: controller.signal,
    })
    expect((await pull(generator)).type).toBe('ready')

    controller.abort()
    expect((await generator.next()).done).toBe(true)

    const next = stream.follow({ userId: OWNER, sessionId: SESSION })
    expect((await pull(next)).type).toBe('ready')
    await next.return(undefined)
  })

  it('greets the session list with ready and then a snapshot', async () => {
    await rig.seed({ events: 0 })
    const generator = streamOf().list({ userId: OWNER })
    expect((await pull(generator)).type).toBe('ready')
    expect((await pull(generator)).type).toBe('snapshot')
    await generator.return(undefined)
  })
})
