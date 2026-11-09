import { describe, expect, it } from 'bun:test'

import { createSession, type CreateSessionApi } from '../create-session'

const fakeApi = () => {
  const posted: { sessionId: string; text: string }[] = []
  const created: { projectId: string }[] = []
  const api: CreateSessionApi = {
    sessions: {
      create: {
        mutate: async (input) => {
          created.push(input)
          return { sessionId: 'ses_1' }
        },
      },
      post: {
        mutate: async (input) => {
          posted.push(input)
          return { inboxId: 1 }
        },
      },
    },
  }
  return { api, created, posted }
}

describe('createSession', () => {
  it('creates a v2 session and posts the first message into it', async () => {
    const fake = fakeApi()
    const sessionId = await createSession({ api: fake.api, projectId: 'p1', text: 'hello' })
    expect(sessionId).toBe('ses_1')
    expect(fake.created).toEqual([{ projectId: 'p1' }])
    expect(fake.posted).toEqual([{ sessionId: 'ses_1', text: 'hello' }])
  })
})
