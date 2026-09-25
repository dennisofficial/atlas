import { describe, expect, it } from 'bun:test'
import { toRunId, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { RemoteEventLog } from '../remote-event-log'
import { SessionsClient } from '../sessions-client'
import { UnreadableWrite } from '../../store/sessions/lines'

type Call = { url: string; method: string; body?: unknown }

const THREAD = toThreadId('brn_test')
const RUN = toRunId('run_test')

const wireEvent = {
  id: 'evt_1',
  threadId: 'brn_test',
  seq: 1,
  runId: 'run_test',
  depth: 0,
  at: '2026-09-15T00:00:00.000Z',
  type: 'user-said',
  body: JSON.stringify({ type: 'user-said', text: 'hello' }),
}

const harness = (responses: unknown[]) => {
  const calls: Call[] = []
  let at = 0
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    calls.push({ url: String(input), method: init?.method ?? 'GET', ...(body === undefined ? {} : { body }) })
    const next = responses[at]
    at += 1
    return new Response(JSON.stringify(next ?? []), { status: 200 })
  }) as typeof fetch
  const client = new SessionsClient({ url: 'http://cloud.test', token: 'sess_test', fetchFn })
  return { log: new RemoteEventLog({ client }), calls }
}

describe('RemoteEventLog', () => {
  it('append encodes drafts and decodes the stamped events', async () => {
    const { log, calls } = harness([[wireEvent]])
    const drafts: EventDraft[] = [{ type: 'user-said', text: 'hello' }]

    const events = await log.append({ threadId: THREAD, runId: RUN, drafts })

    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('http://cloud.test/v1/threads/brn_test/events')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ seq: 1, id: 'evt_1', type: 'user-said' })
  })

  it('append marks context-loaded drafts with their identity columns', async () => {
    const { log, calls } = harness([[]])

    await log.append({
      threadId: THREAD,
      runId: RUN,
      drafts: [{ type: 'context-loaded', slot: 'file', key: 'CLAUDE.md', content: 'the file' }],
    })

    const sent = (calls[0]?.body as { drafts: Record<string, unknown>[] }).drafts[0]
    expect(sent?.contextSlot).toBe('file')
    expect(sent?.contextKey).toBe('CLAUDE.md')
    expect(typeof sent?.contextDigest).toBe('string')
  })

  it('append with no drafts makes no request', async () => {
    const { log, calls } = harness([])

    expect(await log.append({ threadId: THREAD, runId: RUN, drafts: [] })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('append refuses a draft the harness could not read back', async () => {
    const { log, calls } = harness([])

    await expect(
      log.append({
        threadId: THREAD,
        runId: RUN,
        drafts: [{ type: 'nope-not-real' } as unknown as EventDraft],
      }),
    ).rejects.toBeInstanceOf(UnreadableWrite)
    expect(calls).toHaveLength(0)
  })

  it('read passes upTo and readOwn switches the own flag', async () => {
    const { log, calls } = harness([[wireEvent], [wireEvent]])

    await log.read({ threadId: THREAD, upTo: 7 })
    await log.readOwn({ threadId: THREAD })

    expect(calls[0]?.url).toBe('http://cloud.test/v1/threads/brn_test/events?upTo=7')
    expect(calls[1]?.url).toBe('http://cloud.test/v1/threads/brn_test/events?own=true')
  })

  it('head answers the reserved sequence, from the events route the API mounts', async () => {
    const { log, calls } = harness([{ head: 42 }])

    expect(await log.head({ threadId: THREAD })).toBe(42)
    expect(calls[0]?.url).toBe('http://cloud.test/v1/threads/brn_test/events/head')
  })

  it('head retries a 504 rather than failing the read on the first answer', async () => {
    const calls: Call[] = []
    let at = 0
    const responses: { status: number; body: unknown }[] = [
      { status: 504, body: { message: 'gateway timeout' } },
      { status: 200, body: { head: 42 } },
    ]
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' })
      const next = responses[at] ?? responses[responses.length - 1]!
      at += 1
      return new Response(JSON.stringify(next.body), { status: next.status })
    }) as typeof fetch
    const client = new SessionsClient({
      url: 'http://cloud.test',
      token: 'sess_test',
      fetchFn,
    })
    const log = new RemoteEventLog({ client })

    expect(await log.head({ threadId: THREAD })).toBe(42)
    expect(calls).toHaveLength(2)
  })

  it('replace sends the whole log as one PUT and decodes the stamped events', async () => {
    const { log, calls } = harness([[wireEvent]])
    const drafts: EventDraft[] = [{ type: 'user-said', text: 'hello' }]

    const events = await log.replace({ threadId: THREAD, runId: RUN, drafts })

    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe('http://cloud.test/v1/threads/brn_test/events')
    expect((calls[0]?.body as { runId: string }).runId).toBe('run_test')
    expect(events[0]).toMatchObject({ seq: 1, type: 'user-said' })
  })

  it('replace with no drafts still sends the wipe', async () => {
    const { log, calls } = harness([[]])

    expect(await log.replace({ threadId: THREAD, runId: RUN, drafts: [] })).toEqual([])
    expect(calls).toHaveLength(1)
  })
})
