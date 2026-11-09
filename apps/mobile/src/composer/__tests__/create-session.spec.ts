import { describe, expect, it } from 'bun:test'

import { createSession, type CreateSessionApi } from '../create-session'

type CreateInput = Parameters<CreateSessionApi['sessions']['create']['mutate']>[0]

const fakeApi = () => {
  const created: CreateInput[] = []
  const api: CreateSessionApi = {
    sessions: {
      create: {
        mutate: async (input) => {
          created.push(input)
          return { sessionId: 'ses_1' }
        },
      },
    },
  }
  return { api, created }
}

describe('createSession', () => {
  it('creates a v2 session with its first message in one call', async () => {
    const fake = fakeApi()
    const sessionId = await createSession({ api: fake.api, projectId: 'p1', text: 'hello' })
    expect(sessionId).toBe('ses_1')
    expect(fake.created).toEqual([{ projectId: 'p1', firstMessage: { text: 'hello' } }])
  })

  it('carries the picked model, its effort and the fast flag on create', async () => {
    const fake = fakeApi()
    await createSession({
      api: fake.api,
      projectId: 'p1',
      text: 'hello',
      model: 'claude-opus-4',
      effort: 'high',
      fast: true,
    })
    expect(fake.created).toEqual([
      {
        projectId: 'p1',
        model: 'claude-opus-4',
        effort: 'high',
        fast: true,
        firstMessage: { text: 'hello' },
      },
    ])
  })

  it('sends no model fields when the composer stays on Default', async () => {
    const fake = fakeApi()
    await createSession({
      api: fake.api,
      projectId: 'p1',
      text: 'hello',
      model: undefined,
      effort: undefined,
      fast: undefined,
    })
    expect(fake.created).toEqual([{ projectId: 'p1', firstMessage: { text: 'hello' } }])
  })
})
