import { afterEach, describe, expect, it } from 'bun:test'

import { CloudApiError } from '@/lib/cloud-api'

import { fakeFetch, mutationUrl, queryUrl, trpcFailure, trpcOk } from './trpc-fake'

import {
  fetchEvents,
  fetchPod,
  fetchThread,
  fetchThreads,
  patchThreadModel,
  provisionSandbox,
  setThreadArchived,
} from '../threads-api'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('setThreadArchived', () => {
  it('mutates threads.archive with the id and the flag and resolves on success', async () => {
    const calls = fakeFetch(() => trpcOk(undefined))
    await setThreadArchived({ threadId: 'thr/1', archived: true })
    expect(calls).toEqual([
      {
        url: mutationUrl('threads.archive'),
        method: 'POST',
        body: { threadId: 'thr/1', archived: true },
      },
    ])
  })

  it('rejects with the API message when the API answers an error', async () => {
    fakeFetch(() => trpcFailure({ status: 404, details: { message: 'Not found' } }))
    const failure = await setThreadArchived({ threadId: 't1', archived: false }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(CloudApiError)
    expect(failure).toMatchObject({ message: 'Not found', status: 404 })
  })
})

describe('thread reads', () => {
  const thread = {
    id: 'thr_1',
    head: 2,
    createdAt: 'a',
    updatedAt: 'b',
    workspace: null,
    repo: null,
  }

  it('lists a project through threads.list', async () => {
    const calls = fakeFetch(() => trpcOk([thread]))
    expect(await fetchThreads('proj 1')).toEqual([thread])
    expect(calls).toEqual([
      {
        url: queryUrl({ procedure: 'threads.list', input: { projectId: 'proj 1' } }),
        method: 'GET',
        body: undefined,
      },
    ])
  })

  it('gets a thread through threads.get', async () => {
    const calls = fakeFetch(() => trpcOk(thread))
    expect(await fetchThread('thr_1')).toEqual(thread)
    expect(calls[0]?.url).toBe(queryUrl({ procedure: 'threads.get', input: { threadId: 'thr_1' } }))
  })

  it('reads own events through threadEvents.read', async () => {
    const calls = fakeFetch(() => trpcOk([]))
    expect(await fetchEvents('thr_1')).toEqual([])
    expect(calls[0]?.url).toBe(
      queryUrl({ procedure: 'threadEvents.read', input: { threadId: 'thr_1', own: true } }),
    )
  })

  it('reads the pod through threadPod.status', async () => {
    const calls = fakeFetch(() => trpcOk({ state: 'none', steps: [] }))
    expect(await fetchPod('thr_1')).toEqual({ state: 'none', steps: [] })
    expect(calls[0]?.url).toBe(
      queryUrl({ procedure: 'threadPod.status', input: { threadId: 'thr_1' } }),
    )
  })
})

describe('thread writes', () => {
  it('chooses the model through threads.chooseModel with the id beside the model', async () => {
    const calls = fakeFetch(() => trpcOk(undefined))
    await patchThreadModel({ threadId: 'thr_1', model: { ref: 'a/b', effort: 'high' } })
    expect(calls).toEqual([
      {
        url: mutationUrl('threads.chooseModel'),
        method: 'POST',
        body: { threadId: 'thr_1', ref: 'a/b', effort: 'high' },
      },
    ])
  })

  it('provisions a sandbox through threadSandbox.provision', async () => {
    const calls = fakeFetch(() => trpcOk({ state: 'booting' }))
    expect(await provisionSandbox({ threadId: 'thr_1' })).toEqual({ state: 'booting' })
    expect(calls).toEqual([
      {
        url: mutationUrl('threadSandbox.provision'),
        method: 'POST',
        body: { threadId: 'thr_1' },
      },
    ])
  })
})
