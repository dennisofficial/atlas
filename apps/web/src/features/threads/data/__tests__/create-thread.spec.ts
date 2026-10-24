import { afterEach, describe, expect, it } from 'bun:test'

import { ESandboxProvisionState } from '@dltech/atlas-wire/web'

import { fakeFetch, mutationUrl, trpcOk } from './trpc-fake'

import { createThreadBodyOf } from '../create-thread'
import { createThread } from '../threads-api'

describe('createThreadBodyOf', () => {
  it('omits projectId for a thread with no project', () => {
    const body = createThreadBodyOf({ projectId: null, text: '  fix\n the bug ', sendId: 's1' })
    expect(body).toEqual({
      title: 'fix the bug',
      firstMessage: { sendId: 's1', text: '  fix\n the bug ' },
    })
    expect('projectId' in body).toBe(false)
  })

  it('carries the project, model and effort when given', () => {
    expect(
      createThreadBodyOf({
        projectId: 'p1',
        text: 'hi',
        sendId: 's1',
        model: 'm',
        effort: 'high',
      }),
    ).toEqual({
      projectId: 'p1',
      title: 'hi',
      model: 'm',
      effort: 'high',
      firstMessage: { sendId: 's1', text: 'hi' },
    })
  })
})

describe('createThread', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('posts the body once to threads.create and parses the create reply', async () => {
    const calls = fakeFetch(() =>
      trpcOk({
        thread: {
          id: 'thr_1',
          head: 1,
          createdAt: 'a',
          updatedAt: 'b',
          workspace: null,
          repo: null,
          projectId: null,
        },
        provision: { state: ESandboxProvisionState.Booting },
      }),
    )
    const body = createThreadBodyOf({ projectId: null, text: 'hi', sendId: 's1' })
    const reply = await createThread(body)
    expect(calls).toEqual([{ url: mutationUrl('threads.create'), method: 'POST', body }])
    expect(reply.thread.id).toBe('thr_1')
    expect(reply.provision.state).toBe(ESandboxProvisionState.Booting)
  })

  it('rejects a reply that carries no provision', async () => {
    fakeFetch(() =>
      trpcOk({ id: 'thr_1', head: 1, createdAt: 'a', updatedAt: 'b', workspace: null, repo: null }),
    )
    const body = createThreadBodyOf({ projectId: null, text: 'hi', sendId: 's1' })
    await expect(createThread(body)).rejects.toThrow()
  })
})
