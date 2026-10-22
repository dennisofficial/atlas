import { describe, expect, it } from 'vitest'

import { CloudUserFilesClient, UserFileConflict } from '../user-files-client'

type Call = { url: string; method: string; body: unknown }

const clientWith = (respond: (call: Call) => { status: number; body?: unknown }) => {
  const calls: Call[] = []
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    const answer = respond(call)
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
    })
  }) as typeof fetch
  return {
    client: new CloudUserFilesClient({ url: 'http://cloud.test/', token: 't', fetchFn }),
    calls,
  }
}

describe('CloudUserFilesClient', () => {
  it('lists a tree and decodes base64 content on batch get', async () => {
    const { client, calls } = clientWith((call) =>
      call.method === 'GET'
        ? {
            status: 200,
            body: {
              files: [{ path: 'user/a.md', revision: 2, contentHash: 'h', tombstonedAt: null }],
            },
          }
        : {
            status: 200,
            body: {
              files: [
                {
                  path: 'user/a.md',
                  revision: 2,
                  contentHash: 'h',
                  tombstonedAt: null,
                  content: Buffer.from('hi').toString('base64'),
                },
              ],
            },
          },
    )

    expect((await client.listUserFiles({ tree: 'memory' }))[0]?.revision).toBe(2)
    const [file] = await client.getUserFiles({ tree: 'memory', paths: ['user/a.md'] })

    expect(Buffer.from(file?.content ?? new Uint8Array()).toString()).toBe('hi')
    expect(calls[0]?.url).toBe('http://cloud.test/v1/user-files?tree=memory')
    expect(calls[1]?.body).toEqual({ tree: 'memory', paths: ['user/a.md'] })
  })

  it('puts to an encoded per-segment path with the base revision', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: { revision: 3 } }))

    await expect(
      client.putUserFile({
        tree: 'skills',
        path: '.atlas/my skill/SKILL.md',
        content: new Uint8Array([104, 105]),
        contentHash: 'h',
        baseRevision: 2,
      }),
    ).resolves.toEqual({ revision: 3 })

    expect(calls[0]?.url).toBe('http://cloud.test/v1/user-files/skills/.atlas/my%20skill/SKILL.md')
    expect(calls[0]?.body).toEqual({ content: 'aGk=', contentHash: 'h', baseRevision: 2 })
  })

  it('surfaces a 409 as a typed conflict carrying the current revision and hash', async () => {
    const { client } = clientWith((call) =>
      call.method === 'GET'
        ? {
            status: 200,
            body: {
              files: [
                { path: 'user/a.md', revision: 7, contentHash: 'remote', tombstonedAt: null },
              ],
            },
          }
        : { status: 409, body: { currentRevision: 7, contentHash: 'remote' } },
    )

    const failure = await client
      .putUserFile({
        tree: 'memory',
        path: 'user/a.md',
        content: new Uint8Array(),
        contentHash: 'h',
        baseRevision: 1,
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(UserFileConflict)
    expect(failure).toMatchObject({ currentRevision: 7, contentHash: 'remote' })
  })

  it('lets non-409 failures through untouched', async () => {
    const { client } = clientWith(() => ({ status: 403 }))

    await expect(
      client.deleteUserFile({ tree: 'memory', path: 'user/a.md', baseRevision: 1 }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
