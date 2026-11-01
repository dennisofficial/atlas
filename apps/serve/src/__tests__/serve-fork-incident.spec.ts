import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId, type OrphanedInput } from '@dltech/atlas-core'
import { podEventsPostSchema, podEventsTruncateSchema } from '@dltech/atlas-wire'

import { createEventFlusher, httpPostPodEvents, httpTruncatePodEvents } from '../serve-event-flush'
import { resolveForkFor } from '../serve-fork-ports'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { scratchTranscriptStore } from './transcript-store-fixture'
import { trpcFailure, trpcOk, trpcProcedureOf } from './trpc-fake'

const threadId = toThreadId('thread-seq-466')
const controlPlaneUrl = 'https://api.example.com'
const FORK_SEQ = 466

type Row = { seq: number; type: string; body: string }

const saidRow = (args: { seq: number; text: string; requestId: string }): Row => ({
  seq: args.seq,
  type: 'user-said',
  body: JSON.stringify({ type: 'user-said', text: args.text, requestId: args.requestId }),
})

const bodyAt = (seq: number): string =>
  JSON.stringify({ type: 'user-said', text: `message ${seq}`, requestId: `req-${seq}` })

const fakeApi = (args: { alwaysDivergent: boolean }) => {
  const rows: Row[] = []
  for (let seq = 1; seq < FORK_SEQ; seq += 1) {
    rows.push({ seq, type: 'user-said', body: bodyAt(seq) })
  }
  rows.push(saidRow({ seq: FORK_SEQ, text: 'hmr?', requestId: 'Y' }))
  const posts: number[][] = []
  const truncates: number[] = []
  const head = () => rows.reduce((highest, row) => Math.max(highest, row.seq), 0)
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const procedure = trpcProcedureOf(url)
    if (procedure === 'threadEvents.read') {
      const { fromSeq = 0 } = JSON.parse(new URL(url).searchParams.get('input') ?? '{}')
      return trpcOk(
        rows
          .filter((row) => row.seq >= fromSeq)
          .map((row) => ({
            id: `pg-${row.seq}`,
            threadId,
            runId: 'run-api',
            depth: 0,
            at: '2026-11-01T17:27:01.797Z',
            ...row,
          })),
      )
    }
    if (procedure === 'sandboxSelf.truncateEvents') {
      const { toSeq } = podEventsTruncateSchema.parse(JSON.parse(String(init?.body)))
      truncates.push(toSeq)
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if ((rows[index]?.seq ?? 0) > toSeq) rows.splice(index, 1)
      }
      return trpcOk({ head: head() })
    }
    if (procedure === 'sandboxSelf.events') {
      const { events } = podEventsPostSchema.parse(JSON.parse(String(init?.body)))
      posts.push(events.map((event) => event.seq))
      for (const event of events) {
        const existing = rows.find((row) => row.seq === event.seq)
        const diverges = args.alwaysDivergent && event.seq >= FORK_SEQ
        if (existing !== undefined && existing.body === event.body && !diverges) continue
        if (existing !== undefined || event.seq !== head() + 1 || diverges) {
          return trpcFailure({ status: 409, details: { seq: event.seq } })
        }
        rows.push({ seq: event.seq, type: event.type, body: event.body })
      }
      return trpcOk({ head: head() })
    }
    return trpcOk(undefined)
  }) as unknown as typeof fetch
  return { rows, posts, truncates, fetchFn }
}

const podLog = async (args: { podHasY: boolean }) => {
  const store = scratchTranscriptStore({ prefix: 'incident' })
  const append = (draft: object) =>
    store.log.append({ threadId, runId: toRunId('run-pod'), drafts: [draft as never] })
  for (let seq = 1; seq < FORK_SEQ; seq += 1) {
    await append({ type: 'user-said', text: `message ${seq}`, requestId: `req-${seq}` })
  }
  await append({ type: 'user-said', text: 'Lets see whats going on here', requestId: 'X' })
  if (args.podHasY) await append({ type: 'user-said', text: 'hmr?', requestId: 'Y' })
  return store
}

const replay = async (args: { podHasY: boolean; alwaysDivergent: boolean }) => {
  const store = await podLog({ podHasY: args.podHasY })
  const api = fakeApi({ alwaysDivergent: args.alwaysDivergent })
  const remote = { controlPlaneUrl, token: 't', clientVersion: 'dev', fetchFn: api.fetchFn }
  const lines: ServeLogLine[] = []
  const redelivered: OrphanedInput[] = []
  const log = (line: ServeLogLine) => lines.push(line)
  const flusher = createEventFlusher({
    threadId,
    events: store.log,
    durableHead: FORK_SEQ - 1,
    post: httpPostPodEvents(remote),
    truncate: httpTruncatePodEvents(remote),
    resolveFork: resolveForkFor({
      threadId,
      remote,
      events: store.log,
      redeliver: async (input) => {
        redelivered.push(input)
        await store.log.append({
          threadId,
          runId: toRunId('run-redeliver'),
          drafts: [{ type: 'user-said', text: input.text, requestId: input.requestId }],
        })
      },
      log,
    }),
    log,
  })
  return { store, api, flusher, lines, redelivered }
}

describe('seq-466 incident replay', () => {
  it('redelivers the API message, truncates below the fork, re-ships the pod log and settles', async () => {
    const run = await replay({ podHasY: false, alwaysDivergent: false })

    expect(await run.flusher.flush()).toBe(true)

    expect(run.api.truncates).toEqual([FORK_SEQ - 1])
    expect(run.redelivered.map((input) => input.requestId)).toEqual(['Y'])
    expect(run.api.posts.at(-1)).toEqual([FORK_SEQ, FORK_SEQ + 1])
    const localHead = (await run.store.log.head({ threadId })) ?? 0
    expect(run.flusher.durableHead()).toBe(localHead)
    expect(run.api.rows.find((row) => row.seq === FORK_SEQ)?.body).toContain('Lets see')
    expect(run.api.rows.find((row) => row.seq === FORK_SEQ + 1)?.body).toContain('"Y"')
    expect(run.lines.map((line) => line.event)).toContain(EServeEvent.EventForkReconciled)
    expect(await run.flusher.flush()).toBe(true)
  })

  it('does not redeliver a message whose requestId already landed in the pod log', async () => {
    const run = await replay({ podHasY: true, alwaysDivergent: false })

    expect(await run.flusher.flush()).toBe(true)

    expect(run.redelivered).toEqual([])
    expect(run.api.truncates).toEqual([FORK_SEQ - 1])
  })

  it('returns false and logs when the retry conflicts again, without looping', async () => {
    const run = await replay({ podHasY: false, alwaysDivergent: true })

    expect(await run.flusher.flush()).toBe(false)

    expect(run.api.truncates).toEqual([FORK_SEQ - 1])
    expect(run.api.posts).toHaveLength(2)
    expect(run.lines.filter((line) => line.event === EServeEvent.EventFlushConflict)).toHaveLength(
      1,
    )
  })

  it('keeps today’s behaviour with no resolver: logs the conflict and returns false', async () => {
    const store = await podLog({ podHasY: false })
    const api = fakeApi({ alwaysDivergent: false })
    const remote = { controlPlaneUrl, token: 't', clientVersion: 'dev', fetchFn: api.fetchFn }
    const flusher = createEventFlusher({
      threadId,
      events: store.log,
      durableHead: FORK_SEQ - 1,
      post: httpPostPodEvents(remote),
      truncate: httpTruncatePodEvents(remote),
      log: () => undefined,
    })

    expect(await flusher.flush()).toBe(false)
    expect(api.truncates).toEqual([])
  })
})
