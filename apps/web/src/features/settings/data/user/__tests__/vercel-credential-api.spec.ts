import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  deleteUserVercelCredential,
  getUserVercelCredential,
  putUserVercelCredential,
} from '../vercel-credential-api'

let calls: { url: string; init?: RequestInit }[]
const realFetch = globalThis.fetch

const answerWith = (response: Response): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return response
  }) as typeof fetch
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('user Vercel credential api', () => {
  it('reads the credential from /v1/me/vercel', async () => {
    answerWith(
      new Response(
        JSON.stringify({
          configured: true,
          teamId: 'team_me',
          vercelProjectId: 'prj_me',
          updatedAt: '2026-10-21T09:00:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    expect(await getUserVercelCredential()).toEqual({
      configured: true,
      teamId: 'team_me',
      vercelProjectId: 'prj_me',
      updatedAt: '2026-10-21T09:00:00.000Z',
    })
    expect(calls[0]?.url).toBe('/v1/me/vercel')
  })

  it('PUTs team, project and token to /v1/me/vercel', async () => {
    answerWith(new Response(null, { status: 204 }))
    await putUserVercelCredential({ teamId: 'team_me', vercelProjectId: 'prj_me', token: 'tok' })
    expect(calls[0]?.url).toBe('/v1/me/vercel')
    expect(calls[0]?.init?.method).toBe('PUT')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      teamId: 'team_me',
      vercelProjectId: 'prj_me',
      token: 'tok',
    })
  })

  it('DELETEs /v1/me/vercel', async () => {
    answerWith(new Response(null, { status: 204 }))
    await deleteUserVercelCredential()
    expect(calls[0]?.url).toBe('/v1/me/vercel')
    expect(calls[0]?.init?.method).toBe('DELETE')
  })
})
