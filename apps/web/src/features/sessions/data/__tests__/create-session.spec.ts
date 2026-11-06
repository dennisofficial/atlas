import { describe, expect, it } from 'bun:test'

import {
  ATTACHMENTS_UNSUPPORTED,
  createSessionWithMessage,
  type SessionsApi,
} from '../create-session'

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

describe('createSessionWithMessage', () => {
  it('creates the session, then posts the first message to it', async () => {
    const { api, calls } = fakeApi()

    const sessionId = await createSessionWithMessage({
      api,
      projectId: 'proj-1',
      text: 'hello',
      attachments: 0,
    })

    expect(sessionId).toBe('sess-1')
    expect(calls).toEqual([
      ['create', { projectId: 'proj-1' }],
      ['post', { sessionId: 'sess-1', text: 'hello' }],
    ])
  })

  it('fails when the first message cannot be posted', async () => {
    const { api } = fakeApi({ postFails: true })

    await expect(
      createSessionWithMessage({ api, projectId: 'proj-1', text: 'hello', attachments: 0 }),
    ).rejects.toThrow('post refused')
  })

  it('refuses attachments before creating anything', async () => {
    const { api, calls } = fakeApi()

    await expect(
      createSessionWithMessage({ api, projectId: 'proj-1', text: 'hello', attachments: 1 }),
    ).rejects.toThrow(ATTACHMENTS_UNSUPPORTED)
    expect(calls).toEqual([])
  })
})
