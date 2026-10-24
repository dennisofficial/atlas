import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import * as realApiClient from '@/lib/api-client'

let calls: { url: string; init?: RequestInit }[]
let response: Response

const fakeFetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return response
  },
  { preconnect: fetch.preconnect },
)

mock.module('@/lib/api-client', () => ({
  ...realApiClient,
  api: createApiClient({ baseUrl: '', fetchFn: fakeFetch }),
}))

const { deleteUserVercelCredential, getUserVercelCredential, putUserVercelCredential } =
  await import('../vercel-credential-api')

const answerWith = (next: Response): void => {
  response = next
}

const trpcOk = (data?: unknown): Response =>
  Response.json({ result: data === undefined ? {} : { data } })

beforeEach(() => {
  calls = []
})

describe('user Vercel credential api', () => {
  it('reads the credential from userVercel.get', async () => {
    answerWith(
      trpcOk({
        configured: true,
        teamId: 'team_me',
        vercelProjectId: 'prj_me',
        updatedAt: '2026-10-21T09:00:00.000Z',
      }),
    )
    expect(await getUserVercelCredential()).toEqual({
      configured: true,
      teamId: 'team_me',
      vercelProjectId: 'prj_me',
      updatedAt: '2026-10-21T09:00:00.000Z',
    })
    expect(new URL(calls[0]?.url ?? '', 'http://x').pathname).toBe('/v1/trpc/userVercel.get')
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET')
  })

  it('POSTs team, project and token to userVercel.save', async () => {
    answerWith(trpcOk())
    await putUserVercelCredential({ teamId: 'team_me', vercelProjectId: 'prj_me', token: 'tok' })
    expect(calls[0]?.url).toBe('/v1/trpc/userVercel.save')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      teamId: 'team_me',
      vercelProjectId: 'prj_me',
      token: 'tok',
    })
  })

  it('POSTs userVercel.remove', async () => {
    answerWith(trpcOk())
    await deleteUserVercelCredential()
    expect(calls[0]?.url).toBe('/v1/trpc/userVercel.remove')
    expect(calls[0]?.init?.method).toBe('POST')
  })
})
