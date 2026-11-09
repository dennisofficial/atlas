import { describe, expect, it } from 'bun:test'

import { createSessionWithMessage, type SessionsApi } from '../create-session'

const fakeApi = (params: { createFails?: boolean } = {}) => {
  const calls: unknown[][] = []
  const api: SessionsApi = {
    create: async (input) => {
      calls.push(['create', input])
      if (params.createFails === true) throw new Error('create refused')
      return { sessionId: 'sess-1', mainThreadId: 'thread-1' }
    },
    post: async (input) => {
      calls.push(['post', input])
      return { inboxId: 1 }
    },
  }
  return { api, calls }
}

const HASH = 'a'.repeat(64)

const MEDIA = {
  id: `media:${HASH}`,
  name: 'shot.png',
  mediaType: 'image/png',
  size: 4,
  content: { store: 'media' as const, hash: HASH },
}

const UPLOAD = {
  uploadId: '11111111-1111-4111-8111-111111111111',
  pathname: 'composer-uploads/user-1/11111111-1111-4111-8111-111111111111/deploy.sh',
  name: 'deploy.sh',
  size: 12,
  mediaType: 'application/x-sh',
}

describe('createSessionWithMessage', () => {
  it('creates the session with its first message in one call', async () => {
    const { api, calls } = fakeApi()

    const sessionId = await createSessionWithMessage({
      api,
      projectId: 'proj-1',
      text: 'hello',
      media: [],
      uploads: [],
    })

    expect(sessionId).toBe('sess-1')
    expect(calls).toEqual([['create', { projectId: 'proj-1', firstMessage: { text: 'hello' } }]])
  })

  it('posts the images with the first message, text or not', async () => {
    const { api, calls } = fakeApi()

    await createSessionWithMessage({
      api,
      projectId: 'proj-1',
      text: '',
      media: [MEDIA],
      uploads: [],
    })

    expect(calls[0]).toEqual([
      'create',
      { projectId: 'proj-1', firstMessage: { text: '', attachments: [MEDIA] } },
    ])
  })

  it('posts the uploads with the first message', async () => {
    const { api, calls } = fakeApi()

    await createSessionWithMessage({
      api,
      projectId: 'proj-1',
      text: 'run it',
      media: [],
      uploads: [UPLOAD],
    })

    const [, body] = calls[0] ?? []
    const message = (
      body as { firstMessage: { attachments: { id: string; content: { store: string } }[] } }
    ).firstMessage
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments[0]).toMatchObject({
      id: UPLOAD.uploadId,
      content: { store: 'upload' },
    })
    expect('uploads' in message).toBe(false)
  })

  it('names the model the session starts on when one is picked', async () => {
    const { api, calls } = fakeApi()

    await createSessionWithMessage({
      api,
      projectId: 'proj-1',
      text: 'hello',
      media: [],
      uploads: [],
      model: 'openai/gpt-5',
      effort: 'high',
      fast: true,
    })

    expect(calls[0]).toEqual([
      'create',
      {
        projectId: 'proj-1',
        model: 'openai/gpt-5',
        effort: 'high',
        fast: true,
        firstMessage: { text: 'hello' },
      },
    ])
  })

  it('fails when the create is refused', async () => {
    const { api } = fakeApi({ createFails: true })

    await expect(
      createSessionWithMessage({ api, projectId: 'proj-1', text: 'hello', media: [], uploads: [] }),
    ).rejects.toThrow('create refused')
  })
})
