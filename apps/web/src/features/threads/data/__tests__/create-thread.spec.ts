import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ESandboxProvisionState } from '@dltech/atlas-wire/web'

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
  let calls: { url: string; method: string | undefined; body: unknown }[]

  beforeEach(() => {
    calls = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      return new Response(
        JSON.stringify({
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
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('posts the body once and parses the create reply', async () => {
    const body = createThreadBodyOf({ projectId: null, text: 'hi', sendId: 's1' })
    const reply = await createThread(body)
    expect(calls).toEqual([{ url: '/v1/threads', method: 'POST', body }])
    expect(reply.thread.id).toBe('thr_1')
    expect(reply.provision.state).toBe(ESandboxProvisionState.Booting)
  })
})
