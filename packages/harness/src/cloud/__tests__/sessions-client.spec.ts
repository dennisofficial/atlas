import type { EventsWatchFrame } from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it } from 'bun:test'

import { CloudError } from '../cloud-transport'
import { SessionsClient } from '../sessions-client'

type Seen = { url: string; method: string; body: unknown; authorization: string | null }

const thread = {
  id: 'thr_1',
  head: 0,
  createdAt: 'a',
  updatedAt: 'b',
  workspace: null,
  repo: null,
}

const ok = (data: unknown): Response => Response.json({ result: { data } })

const failure = (status: number): Response =>
  Response.json(
    {
      error: {
        message: 'failed',
        code: -32603,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: status },
      },
    },
    { status },
  )

const clientAnswering = (reply: () => Response) => {
  const seen: Seen[] = []
  const fetchFn: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        authorization: new Headers(init?.headers).get('authorization'),
      })
      return reply()
    },
    { preconnect: fetch.preconnect },
  )
  return { client: new SessionsClient({ url: 'https://cloud.test/', token: 'tok', fetchFn }), seen }
}

const queryUrl = (args: { procedure: string; input: unknown }): string =>
  `https://cloud.test/v1/trpc/${args.procedure}?input=${encodeURIComponent(JSON.stringify(args.input))}`

describe('SessionsClient over tRPC', () => {
  it('opens a thread sending the client-chosen id as id', async () => {
    const { client, seen } = clientAnswering(() => ok({ thread, events: [] }))
    await client.openThread({
      threadId: 'thr_1',
      runId: 'run_1',
      drafts: [{ type: 'user-said', body: '{}' }],
      workspace: '/w',
    })
    expect(seen).toEqual([
      {
        url: 'https://cloud.test/v1/trpc/threads.open',
        method: 'POST',
        body: {
          id: 'thr_1',
          runId: 'run_1',
          drafts: [{ type: 'user-said', body: '{}' }],
          workspace: '/w',
        },
        authorization: 'Bearer tok',
      },
    ])
  })

  it('finds a thread by query and answers undefined on 404', async () => {
    const found = clientAnswering(() => ok(thread))
    expect(await found.client.findThread({ threadId: 'thr_1' })).toEqual(thread)
    expect(found.seen[0]?.url).toBe(
      queryUrl({ procedure: 'threads.get', input: { threadId: 'thr_1' } }),
    )
    const missing = clientAnswering(() => failure(404))
    expect(await missing.client.findThread({ threadId: 'thr_1' })).toBeUndefined()
  })

  it('answers undefined for a null recent thread', async () => {
    const { client, seen } = clientAnswering(() => ok(null))
    expect(await client.mostRecentThread({ project: '/p' })).toBeUndefined()
    expect(seen[0]?.url).toBe(queryUrl({ procedure: 'threads.recent', input: { project: '/p' } }))
  })

  it('reads own events with upTo through threadEvents.read', async () => {
    const { client, seen } = clientAnswering(() => ok([]))
    await client.readEvents({ threadId: 'thr_1', upTo: 4, own: true })
    expect(seen[0]?.url).toBe(
      queryUrl({
        procedure: 'threadEvents.read',
        input: { threadId: 'thr_1', upTo: 4, own: true },
      }),
    )
  })

  it('reads own events from a seq through threadEvents.read', async () => {
    const { client, seen } = clientAnswering(() => ok([]))
    await client.readEvents({ threadId: 'thr_1', fromSeq: 466, own: true })
    expect(seen[0]?.url).toBe(
      queryUrl({
        procedure: 'threadEvents.read',
        input: { threadId: 'thr_1', fromSeq: 466, own: true },
      }),
    )
  })

  it('returns the replaced count of a compaction and the head of a thread', async () => {
    const compacted = clientAnswering(() => ok({ replaced: 3 }))
    expect(
      await compacted.client.compactThread({
        threadId: 'thr_1',
        anchor: 'prefix',
        fromSeq: 1,
        throughSeq: 4,
        summary: 's',
      }),
    ).toBe(3)
    const head = clientAnswering(() => ok({ head: 9 }))
    expect(await head.client.threadHead({ threadId: 'thr_1' })).toBe(9)
  })

  it('merges the turn spend with the thread and run ids', async () => {
    const { client, seen } = clientAnswering(() => ok(null))
    const spend = {
      status: 'done',
      providerId: 'p',
      modelId: 'm',
      steps: 1,
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      startedAt: '2026-10-24T00:00:00.000Z',
      endedAt: '2026-10-24T00:00:01.000Z',
      durationMs: 1000,
    }
    await client.recordTurn({ threadId: 'thr_1', runId: 'run_1', spend })
    expect(seen[0]?.body).toEqual({ ...spend, threadId: 'thr_1', runId: 'run_1' })
  })

  it('raises a CloudError carrying the status on a refusal', async () => {
    const { client } = clientAnswering(() => failure(403))
    const raised = await client.renameThread({ threadId: 'thr_1', title: 't' }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(raised).toBeInstanceOf(CloudError)
    expect(raised).toMatchObject({ status: 403 })
  })
})

type FakeEvent = { data?: string; message?: string }
type Listeners = Map<string, Array<(event: FakeEvent) => void>>

class DroppingEventSource {
  static latest: DroppingEventSource | undefined

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2
  readyState = 0
  private readonly listeners: Listeners = new Map()

  constructor(readonly url: string) {
    DroppingEventSource.latest = this
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((one) => one !== listener),
    )
  }

  close(): void {
    this.readyState = this.CLOSED
  }

  emit(type: string, event: FakeEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const openedSource = async (): Promise<DroppingEventSource> => {
  const deadline = Date.now() + 2000
  while (DroppingEventSource.latest === undefined && Date.now() < deadline) await Bun.sleep(5)
  const source = DroppingEventSource.latest
  if (source === undefined) throw new Error('the watch never opened an event source')
  return source
}

const settled = async (done: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2000
  while (!done() && Date.now() < deadline) await Bun.sleep(5)
}

describe('SessionsClient.watchEvents', () => {
  beforeEach(() => {
    DroppingEventSource.latest = undefined
  })

  it('hands the pod the frame it was sent', async () => {
    const frames: EventsWatchFrame[] = []
    const client = new SessionsClient({
      url: 'https://cloud.test/',
      token: 'tok',
      EventSource: DroppingEventSource,
    })
    const stop = client.watchEvents({
      threadId: 'thr_1',
      onTick: (frame) => frames.push(frame),
      onFailure: () => undefined,
      onEnded: () => undefined,
    })
    const source = await openedSource()
    source.emit('connected', { data: '{}' })
    source.emit('message', { data: JSON.stringify({ type: 'keepalive' }) })
    await settled(() => frames.length === 1)
    stop()

    expect(frames).toHaveLength(1)
    expect(String(frames[0]?.type)).toBe('keepalive')
  })

  it('reports a dropped transport as a failure and ends the stream so the caller reconnects', async () => {
    const failures: string[] = []
    let ended = 0
    const client = new SessionsClient({
      url: 'https://cloud.test/',
      token: 'tok',
      EventSource: DroppingEventSource,
    })
    const stop = client.watchEvents({
      threadId: 'thr_1',
      onTick: () => undefined,
      onFailure: (reason) => failures.push(reason),
      onEnded: () => (ended += 1),
    })
    const source = await openedSource()
    source.emit('connected', { data: '{}' })
    source.emit('error', { message: 'socket hang up' })
    await settled(() => failures.length === 1)

    expect(failures).toEqual(['socket hang up'])
    expect(source.readyState).toBe(source.CLOSED)
    expect(ended).toBe(0)
    stop()
  })
})
