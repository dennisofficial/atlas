import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { workspaceSpecFetcher } from '../workspace-spec'

const threadId = toThreadId('thread-serve')

const fetcher = (respond: (url: string, init?: RequestInit) => Response) =>
  workspaceSpecFetcher({
    controlPlaneUrl: 'https://api.example.com/',
    threadId,
    token: 'session-token',
    fetchFn: (async (input: unknown, init?: RequestInit) =>
      respond(String(input), init)) as typeof fetch,
  })

describe('workspaceSpecFetcher', () => {
  it('reads the spec from the thread endpoint under the session token', async () => {
    const seen: { url: string; authorization: unknown }[] = []
    const fetchSpec = fetcher((url, init) => {
      seen.push({ url, authorization: (init?.headers as Record<string, string>)?.authorization })
      return Response.json({
        remoteUrl: 'https://github.com/dennisofficial/atlas.git',
        branch: 'main',
        commit: null,
        patch: '',
        githubToken: null,
      })
    })

    await expect(fetchSpec()).resolves.toEqual({
      remoteUrl: 'https://github.com/dennisofficial/atlas.git',
      branch: 'main',
      commit: null,
      patch: '',
      githubToken: null,
    })
    expect(seen[0]).toEqual({
      url: 'https://api.example.com/v1/sandboxes/thread-serve/workspace',
      authorization: 'Bearer session-token',
    })
  })

  it('names the status the control plane refused with', async () => {
    const fetchSpec = fetcher(() => new Response('unauthorized', { status: 401 }))

    await expect(fetchSpec()).rejects.toThrow('with 401')
  })
})
