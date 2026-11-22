import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { cipher, seedApiKeyAccount, seedOwner } from '../../config/__tests__/config-reader.fixture'
import { setting } from '../../config/__tests__/model-config.fixture'
import { sessionNamerOf } from '../session-namer'

const testDb = useTestDatabase()

const refusingTokens = {
  issue: () => Promise.reject(new Error('no oauth connection in this spec')),
}

type SeenCall = { url: string; headers: Headers; body: string }

const recordFetch = (): SeenCall[] => {
  const seen: SeenCall[] = []
  const stub = async (input: URL | string, init?: RequestInit): Promise<Response> => {
    seen.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    })
    return Response.json({ error: { message: 'stubbed refusal' } }, { status: 400 })
  }
  spyOn(globalThis, 'fetch').mockImplementation(stub as unknown as typeof fetch)
  return seen
}

afterEach(() => {
  const spied = globalThis.fetch as unknown as { mockRestore?: () => void }
  spied.mockRestore?.()
})

describe('sessionNamerOf', () => {
  it('reports the missing account and answers null', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const faults: string[] = []
    const namer = sessionNamerOf({ db, cipher, tokens: refusingTokens })

    const title = await namer({
      userId: 'user-1',
      projectId: 'proj-1',
      text: 'fix the login bug',
      onFault: (fault) => faults.push(String(fault)),
    })

    expect(title).toBeNull()
    expect(faults).toHaveLength(1)
    expect(faults[0]).toContain('no model account')
  })

  it('calls the quick model the project settings name, with the account key', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    await db.orm.public.ProjectSetting.create({
      id: 'ps-1',
      projectId: 'proj-1',
      key: 'model.quickModel',
      value: setting('anthropic/claude-sonnet-4-5'),
    })
    const seen = recordFetch()
    const faults: unknown[] = []

    const title = await sessionNamerOf({ db, cipher, tokens: refusingTokens })({
      userId: 'user-1',
      projectId: 'proj-1',
      text: 'fix the login bug',
      onFault: (fault) => faults.push(fault),
    })

    expect(title).toBeNull()
    expect(faults).toHaveLength(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toContain('api.anthropic.com')
    expect(seen[0]?.headers.get('x-api-key')).toBe('sk-test')
    expect(JSON.parse(seen[0]?.body ?? '{}').model).toBe('claude-sonnet-4-5')
  })

  it('retries on the session model when the quick model fails', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    const seen = recordFetch()

    await sessionNamerOf({ db, cipher, tokens: refusingTokens })({
      userId: 'user-1',
      projectId: null,
      text: 'fix the login bug',
      modelRef: 'anthropic/claude-opus-4-1',
    })

    expect(seen.map((call) => JSON.parse(call.body).model)).toEqual([
      'claude-haiku-4-5',
      'claude-opus-4-1',
    ])
  })
})
