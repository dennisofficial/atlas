import { describe, expect, it } from 'bun:test'
import { ECompactionAnchor, EForkMode, EExecutionLocation, toThreadId, toRunId } from '@dltech/atlas-core'

import { RemoteThreadStore } from '../remote-thread-store'
import { SessionsClient } from '../sessions-client'

type Call = { url: string; method: string; body?: unknown }

const wireThread = {
  id: 'brn_1',
  head: 3,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:01:00.000Z',
  workspace: '/repo',
  repo: '/repo',
  title: 'a thread',
  forkMode: 'reference',
  parent: { threadId: 'brn_parent', forkSeq: 2 },
  agent: { spawnedBy: 'brn_spawner', type: 'explore' },
  model: { ref: 'anthropic/claude-opus', effort: 'high' },
  executionLocation: 'cloud',
}

const harness = (responses: unknown[], statuses?: number[]) => {
  const calls: Call[] = []
  let at = 0
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      ...(body === undefined ? {} : { body }),
    })
    const status = statuses?.[at] ?? 200
    const next = status === 204 ? undefined : responses[at]
    at += 1
    return new Response(next === undefined ? '' : JSON.stringify(next), { status })
  }) as typeof fetch
  const client = new SessionsClient({ url: 'http://cloud.test', token: 'sess_test', fetchFn })
  return { store: new RemoteThreadStore({ client }), calls }
}

describe('RemoteThreadStore', () => {
  it('create posts the draft and maps the summary', async () => {
    const { store, calls } = harness([wireThread])

    const thread = await store.create({ title: 'a thread', workspace: '/repo' })

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'http://cloud.test/v1/threads',
      body: { title: 'a thread', workspace: '/repo' },
    })
    expect(thread).toMatchObject({
      id: 'brn_1',
      head: 3,
      title: 'a thread',
      parent: { threadId: 'brn_parent', forkSeq: 2 },
      forkMode: EForkMode.Reference,
      agent: { spawnedBy: 'brn_spawner', type: 'explore' },
      model: { ref: 'anthropic/claude-opus', effort: 'high' },
    })
    expect(thread.executionLocation).toBeUndefined()
  })

  it('find returns undefined when the thread is missing', async () => {
    const { store } = harness([], [404])

    expect(await store.find({ threadId: toThreadId('brn_nope') })).toBeUndefined()
  })

  it('mostRecent treats a null body as no thread', async () => {
    const { store } = harness([null])

    expect(await store.mostRecent({ project: '/repo' })).toBeUndefined()
  })

  it('list encodes project and limit and maps enrichment fields', async () => {
    const enriched = {
      ...wireThread,
      worktree: { path: '/repo/.atlas/worktrees/one', branch: 'dennis/one' },
      pullRequests: [{ number: 421, url: 'https://x/y', repo: 'x/y', branch: 'b' }],
    }
    const { store, calls } = harness([[enriched]])

    const threads = await store.list({ project: '/repo with spaces', limit: 10 })

    expect(calls[0]?.url).toBe(
      'http://cloud.test/v1/threads?project=%2Frepo%20with%20spaces&limit=10',
    )
    expect(threads[0]?.worktree).toEqual({ path: '/repo/.atlas/worktrees/one', branch: 'dennis/one' })
    expect(threads[0]?.pullRequests?.[0]?.number).toBe(421)
  })

  it('createWithFirstEvents posts encoded drafts and decodes both halves', async () => {
    const opened = {
      thread: wireThread,
      events: [
        {
          id: 'evt_1',
          threadId: 'brn_1',
          seq: 1,
          runId: 'run_1',
          depth: 0,
          at: '2026-09-15T00:00:00.000Z',
          type: 'user-said',
          body: JSON.stringify({ type: 'user-said', text: 'hi' }),
        },
      ],
    }
    const { store, calls } = harness([opened])

    const result = await store.createWithFirstEvents({
      threadId: toThreadId('brn_1'),
      runId: toRunId('run_1'),
      drafts: [{ type: 'user-said', text: 'hi' }],
      title: 'a thread',
    })

    expect(calls[0]?.url).toBe('http://cloud.test/v1/threads/open')
    expect((calls[0]?.body as { drafts: unknown[] }).drafts).toHaveLength(1)
    expect(result.thread.id).toBe(toThreadId('brn_1'))
    expect(result.events[0]).toMatchObject({ seq: 1, type: 'user-said' })
  })

  it('writes reach their routes: rename, model, location, adopt, rewind', async () => {
    const { store, calls } = harness([], [204, 204, 204, 204, 204])
    const threadId = toThreadId('brn_1')

    await store.rename({ threadId, title: 'new' })
    await store.chooseModel({ threadId, model: { ref: 'r', effort: 'e' } })
    await store.chooseExecutionLocation({ threadId, location: EExecutionLocation.Docker })
    await store.adopt({ threadId, workspace: '/w', repo: null })
    await store.rewind({ threadId, toSeq: 2, cutAgents: [toThreadId('brn_a')] })

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PATCH http://cloud.test/v1/threads/brn_1/title',
      'PATCH http://cloud.test/v1/threads/brn_1/model',
      'PATCH http://cloud.test/v1/threads/brn_1/location',
      'PATCH http://cloud.test/v1/threads/brn_1/workspace',
      'POST http://cloud.test/v1/threads/brn_1/rewind',
    ])
    expect(calls[4]?.body).toEqual({ toSeq: 2, cutAgents: ['brn_a'] })
  })

  it('compact and summarise answer the replaced count', async () => {
    const { store, calls } = harness([{ replaced: 4 }, { replaced: 2 }])
    const threadId = toThreadId('brn_1')

    const compacted = await store.compact({
      threadId,
      anchor: ECompactionAnchor.Prefix,
      fromSeq: 1,
      throughSeq: 6,
      summary: 'the start',
    })
    const summarised = await store.summarise({
      threadId,
      anchor: ECompactionAnchor.Suffix,
      fromSeq: 3,
      throughSeq: 5,
      summary: 'the end',
      cutAgents: [toThreadId('brn_a')],
    })

    expect(compacted).toBe(4)
    expect(summarised).toBe(2)
    expect(calls[0]?.url).toBe('http://cloud.test/v1/threads/brn_1/compact')
    expect(calls[1]?.url).toBe('http://cloud.test/v1/threads/brn_1/summarise')
    expect(calls[1]?.body).toMatchObject({ anchor: 'suffix', cutAgents: ['brn_a'] })
  })

  it('fork posts the mode and maps the new thread', async () => {
    const { store, calls } = harness([wireThread])

    const forked = await store.fork({
      from: toThreadId('brn_1'),
      seq: 2,
      mode: EForkMode.Copy,
      title: 'copy',
    })

    expect(calls[0]?.body).toEqual({ seq: 2, mode: 'copy', title: 'copy' })
    expect(forked.id).toBe(toThreadId('brn_1'))
  })
})
