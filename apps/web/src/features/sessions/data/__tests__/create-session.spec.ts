import { describe, expect, it } from 'bun:test'

import { createSessionWithMessage, type SessionsApi } from '../create-session'

const fakeApi = (params: { postFails?: boolean } = {}) => {
  const calls: unknown[][] = []
  const api: SessionsApi = {
    create: async (input) => {
      calls.push(['create', input])
      return { sessionId: 'sess-1', mainThreadId: 'thread-1' }
    },
    post: async (input) => {
      calls.push(['post', input])
      if (params.postFails === true) throw new Error('post refused')
      return { inboxId: 1 }
    },
  }
  return { api, calls }
}

const HASH = 'a'.repeat(64)

describe('createSessionWithMessage', () => {
  it('creates the session, then posts the first message to it', async () => {
    const { api, calls } = fakeApi()

    const sessionId = await createSessionWithMessage({
      api,
      projectId: 'proj-1',
      text: 'hello',
      media: [],
    })

    expect(sessionId).toBe('sess-1')
    expect(calls).toEqual([
      ['create', { projectId: 'proj-1' }],
      ['post', { sessionId: 'sess-1', text: 'hello' }],
    ])
  })

  it('posts the images with the first message, text or not', async () => {
    const { api, calls } = fakeApi()

    await createSessionWithMessage({
      api,
      projectId: 'proj-1',
      text: '',
      media: [{ hash: HASH, source: 'shot.png' }],
    })

    expect(calls[1]).toEqual([
      'post',
      { sessionId: 'sess-1', text: '', media: [{ hash: HASH, source: 'shot.png' }] },
    ])
  })

  it('fails when the first message cannot be posted', async () => {
    const { api } = fakeApi({ postFails: true })

    await expect(
      createSessionWithMessage({ api, projectId: 'proj-1', text: 'hello', media: [] }),
    ).rejects.toThrow('post refused')
  })
})
