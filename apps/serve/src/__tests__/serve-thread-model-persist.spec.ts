import { describe, expect, it } from 'bun:test'
import { NoticePort, toThreadId, type NoticePost } from '@dltech/atlas-core'
import { API_PROVISIONED_ENV, EServeEnv } from '@dltech/atlas-wire'

import { threadModelPersisterOf } from '../serve-thread-model-persist'

import { trpcFailure, trpcOk, trpcUrl } from './trpc-fake'

const threadId = toThreadId('thr_persist')
const PICKED = { ref: 'openai/gpt-5-codex', effort: 'high' }

class RecordingNotice extends NoticePort {
  readonly posts: NoticePost[] = []
  notify(post: NoticePost): void {
    this.posts.push(post)
  }
}

const bind = (args: { env: Record<string, string | undefined>; status?: number }) => {
  const requests: {
    url: string
    method: string | undefined
    body: unknown
    auth: string | null
  }[] = []
  const notice = new RecordingNotice()
  const persist = threadModelPersisterOf({
    env: args.env,
    threadId,
    controlPlaneUrl: 'https://api.example.com',
    token: 'sandbox-token',
    clientVersion: '1.2.3',
    notice,
    fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body)),
        auth: new Headers(init?.headers).get('authorization'),
      })
      return args.status === undefined ? trpcOk(undefined) : trpcFailure({ status: args.status })
    }) as unknown as typeof fetch,
  })
  return { persist, requests, notice }
}

describe('threadModelPersisterOf', () => {
  it('is absent when the pod has no control plane', () => {
    expect(bind({ env: {} }).persist).toBeUndefined()
  })

  it('posts the thread model with the sandbox token when API-provisioned', async () => {
    const { persist, requests } = bind({ env: { [API_PROVISIONED_ENV]: '1' } })
    await persist?.(PICKED)
    expect(requests).toEqual([
      {
        url: trpcUrl({
          controlPlaneUrl: 'https://api.example.com',
          procedure: 'threads.chooseModel',
        }),
        method: 'POST',
        body: { threadId, ...PICKED },
        auth: 'Bearer sandbox-token',
      },
    ])
  })

  it('posts the thread model from a registered pod the TUI provisioned', async () => {
    const { persist, requests } = bind({
      env: { [EServeEnv.CloudUrl]: 'https://api.example.com', [EServeEnv.Token]: 'sandbox-token' },
    })
    await persist?.(PICKED)
    expect(requests.map((request) => request.url)).toEqual([
      trpcUrl({ controlPlaneUrl: 'https://api.example.com', procedure: 'threads.chooseModel' }),
    ])
  })

  it('posts a warn notice and rejects when the API refuses', async () => {
    const { persist, notice } = bind({ env: { [API_PROVISIONED_ENV]: '1' }, status: 500 })
    await expect(persist?.(PICKED)).rejects.toThrow()
    expect(notice.posts).toHaveLength(1)
    expect(notice.posts[0]).toMatchObject({ tone: 'warn', key: 'thread-model-persist' })
  })
})
