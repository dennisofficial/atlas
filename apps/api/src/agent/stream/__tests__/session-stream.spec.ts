import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  EStreamSurface,
  STREAM_HEARTBEAT_MS,
  STREAM_PROTOCOL_VERSION,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { createSessionStream, SessionStreamLimitError } from '../session-stream'
import { createUserSlots } from '../user-slots'
import { FollowRig, OWNER, said, SESSION, THREAD } from './follow-rig'

const pull = async (
  generator: AsyncGenerator<StreamServerMessage>,
): Promise<StreamServerMessage> => {
  const step = await generator.next()
  if (step.done === true) throw new Error('the stream ended early')
  return step.value
}

const nextPayload = async (
  generator: AsyncGenerator<StreamServerMessage>,
): Promise<StreamServerMessage> => {
  for (;;) {
    const frame = await pull(generator)
    if (frame.type !== 'pong') return frame
  }
}

const eventsFrame = async (
  generator: AsyncGenerator<StreamServerMessage>,
): Promise<Extract<StreamServerMessage, { type: 'events' }>> => {
  for (;;) {
    const frame = await pull(generator)
    if (frame.type === 'events') return frame
  }
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

  const streamOf = (args: { limit?: number; eventTypes?: readonly string[] } = {}) => {
    const stream = createSessionStream({
      users: createUserSlots({ limit: args.limit ?? 4 }),
      timers: rig.timers,
      eventTypes: args.eventTypes ?? ['user-said'],
      log: undefined,
    })
    stream.start({ subscriptions: rig.follow })
    return stream
  }

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

  it('follows every burst with a trailing pong so a buffering proxy releases it', async () => {
    await rig.seed({ events: 2 })
    const generator = streamOf().follow({ userId: OWNER, sessionId: SESSION })
    expect((await pull(generator)).type).toBe('ready')

    let frame = await pull(generator)
    for (let seen = 0; frame.type !== 'events'; seen += 1) {
      if (seen >= 10) throw new Error('the stream never sent an events frame')
      frame = await pull(generator)
    }
    expect((await pull(generator)).type).toBe('pong')
    await generator.return(undefined)
  })

  it('pongs a subscription that has been idle for the heartbeat interval', async () => {
    await rig.seed({ events: 0 })
    const generator = streamOf().follow({ userId: OWNER, sessionId: SESSION })
    expect((await pull(generator)).type).toBe('ready')
    expect((await pull(generator)).type).toBe('pong')

    rig.timers.advance(STREAM_HEARTBEAT_MS)
    expect((await pull(generator)).type).toBe('pong')

    await generator.return(undefined)
    expect(rig.timers.pendingCount()).toBe(0)
  })

  it('holds the heartbeat back while frames keep flowing', async () => {
    await rig.seed({ events: 0 })
    const generator = streamOf().follow({ userId: OWNER, sessionId: SESSION })
    expect((await pull(generator)).type).toBe('ready')

    for (let n = 1; n <= 3; n += 1) {
      rig.timers.advance(STREAM_HEARTBEAT_MS - 5_000)
      expect(rig.timers.pendingCount()).toBe(1)
      await rig.append([said(`m${n}`)])
      const frame = await eventsFrame(generator)
      expect(frame.events.map((event) => Number(event.seq))).toEqual([n])
    }

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
    expect((await nextPayload(generator)).type).toBe('snapshot')
    await generator.return(undefined)
  })

  it('records the surface a desktop follower declares, so an mcp sign-in returns to the app', async () => {
    await rig.seed({ events: 1 })
    const generator = streamOf().follow({
      userId: OWNER,
      sessionId: SESSION,
      surface: EStreamSurface.Desktop,
    })
    expect((await pull(generator)).type).toBe('ready')
    expect(await liveSeqs(generator)).toEqual([1])

    expect(rig.surfaces).toEqual([
      { sessionId: SESSION, userId: OWNER, surface: EStreamSurface.Desktop },
    ])
    await generator.return(undefined)
  })

  it('records web when the follower declares no surface', async () => {
    await rig.seed({ events: 1 })
    const generator = streamOf().follow({ userId: OWNER, sessionId: SESSION })
    expect((await pull(generator)).type).toBe('ready')
    expect(await liveSeqs(generator)).toEqual([1])

    expect(rig.surfaces).toEqual([
      { sessionId: SESSION, userId: OWNER, surface: EStreamSurface.Web },
    ])
    await generator.return(undefined)
  })

  it('follows the child thread the caller names', async () => {
    await rig.seed({ events: 1 })
    const child = 'child-thread'
    await rig.plane.createThread({ threadId: child, sessionId: SESSION })
    await rig.appendTo({ threadId: child, bodies: [said('child work')] })

    const generator = streamOf().follow({ userId: OWNER, sessionId: SESSION, threadId: child })
    expect((await pull(generator)).type).toBe('ready')
    expect(await liveSeqs(generator)).toEqual([1])
    await generator.return(undefined)
  })
})
