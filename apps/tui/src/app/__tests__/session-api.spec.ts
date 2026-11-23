import { describe, expect, test } from 'bun:test'

import { createApiClient, type ApiClient } from '@dltech/atlas-api-router'

import { sessionApiOf, type SessionApi } from '../session-api'

type Call = { route: string; input: unknown }

const answeringWith = (status: number): ApiClient =>
  createApiClient({
    baseUrl: 'https://api.example.test',
    token: 'token-1',
    fetchFn: (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: `the route answered ${status}`,
            code: -32603,
            data: { code: 'UNAUTHORIZED', httpStatus: status },
          },
        }),
        { status, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  })

const clientOf = (args: { calls: Call[] }): ApiClient => {
  const record = <T>(route: string, input: unknown, reply: T): Promise<T> => {
    args.calls.push({ route, input })
    return Promise.resolve(reply)
  }

  return {
    sessions: {
      post: { mutate: (input: unknown) => record('sessions.post', input, { inboxId: 7 }) },
      withdraw: {
        mutate: (input: unknown) => record('sessions.withdraw', input, { ok: true as const }),
      },
      stop: { mutate: (input: unknown) => record('sessions.stop', input, { inboxId: 8 }) },
      retry: { mutate: (input: unknown) => record('sessions.retry', input, { inboxId: 9 }) },
      wakePod: {
        mutate: (input: unknown) => record('sessions.wakePod', input, { state: 'waking' as const }),
      },
    },
    operatorRequests: {
      answer: { mutate: (input: unknown) => record('operatorRequests.answer', input, undefined) },
    },
    media: {
      presign: {
        mutate: (input: unknown) =>
          record('media.presign', input, {
            exists: false as const,
            uploadUrl: 'https://upload.example.test/1',
            validUntil: 0,
          }),
      },
      confirm: {
        mutate: (input: unknown) =>
          record('media.confirm', input, {
            media: { hash: 'a'.repeat(64), mediaType: 'image/png', size: 1, width: 1, height: 1 },
          }),
      },
    },
    composerUploads: {
      presign: {
        mutate: (input: unknown) =>
          record('composerUploads.presign', input, {
            upload: {
              uploadId: 'upload-1',
              pathname: 'composer-uploads/a.png',
              name: 'a.png',
              size: 1,
              mediaType: 'image/png',
            },
            uploadUrl: 'https://upload.example.test/1',
            validUntil: 0,
          }),
      },
      discard: {
        mutate: (input: unknown) => record('composerUploads.discard', input, { ok: true }),
      },
    },
    composerDrafts: {
      get: { query: (input: unknown) => record('composerDrafts.get', input, { draft: null }) },
      put: { mutate: (input: unknown) => record('composerDrafts.put', input, {}) },
      clear: { mutate: (input: unknown) => record('composerDrafts.clear', input, { ok: true }) },
    },
    files: {
      tree: {
        query: (input: unknown) => record('files.tree', input, { directory: '', entries: [] }),
      },
      search: {
        query: (input: unknown) => record('files.search', input, { paths: [], truncated: false }),
      },
      read: {
        query: (input: unknown) => record('files.read', input, { file: { type: 'refused' } }),
      },
    },
  } as unknown as ApiClient
}

const apiOf = (args: { calls: Call[]; lost: number[] }) =>
  sessionApiOf({
    api: clientOf({ calls: args.calls }),
    onAuthLost: (status) => args.lost.push(status),
  })

const refusingOf = (args: { status: number; lost: number[] }): SessionApi =>
  sessionApiOf({
    api: answeringWith(args.status),
    onAuthLost: (status) => args.lost.push(status),
  })

describe('sessionApiOf', () => {
  test('passes a post body straight to the route', async () => {
    const calls: Call[] = []
    const lost: number[] = []
    const api: SessionApi = apiOf({ calls, lost })

    const reply = await api.post({ sessionId: 'session-1', text: 'hello', clientId: 'c1' })

    expect(reply).toEqual({ inboxId: 7 })
    expect(calls).toEqual([
      { route: 'sessions.post', input: { sessionId: 'session-1', text: 'hello', clientId: 'c1' } },
    ])
    expect(lost).toEqual([])
  })

  test('reports a 401 to onAuthLost and still rejects the caller', async () => {
    const lost: number[] = []
    const api = refusingOf({ status: 401, lost })

    await expect(api.post({ sessionId: 'session-1', text: 'hello' })).rejects.toThrow()
    expect(lost).toEqual([401])
  })

  test('reports a 403 to onAuthLost as well', async () => {
    const lost: number[] = []
    const api = refusingOf({ status: 403, lost })

    await expect(api.stop({ sessionId: 'session-1' })).rejects.toThrow()
    expect(lost).toEqual([403])
  })

  test('a 500 reaches the caller only', async () => {
    const lost: number[] = []
    const api = refusingOf({ status: 500, lost })

    await expect(api.retry({ sessionId: 'session-1' })).rejects.toThrow()
    expect(lost).toEqual([])
  })

  test('a network error reaches neither', async () => {
    const lost: number[] = []
    const api = sessionApiOf({
      api: {
        sessions: {
          post: {
            mutate: () => Promise.reject(new TypeError('fetch failed')),
          },
        },
      } as unknown as ApiClient,
      onAuthLost: (status) => lost.push(status),
    })

    await expect(api.post({ sessionId: 'session-1', text: 'hello' })).rejects.toThrow(
      'fetch failed',
    )
    expect(lost).toEqual([])
  })

  test('maps a missing draft to null and a stored draft to its text', async () => {
    const missing = sessionApiOf({
      api: {
        composerDrafts: { get: { query: async () => ({ draft: null }) } },
      } as unknown as ApiClient,
      onAuthLost: () => undefined,
    })
    expect(await missing.loadDraft('session-1')).toBeNull()

    const stored = sessionApiOf({
      api: {
        composerDrafts: {
          get: {
            query: async () => ({
              draft: { scope: 'session-1', text: 'half typed', uploads: [], updatedAt: '' },
            }),
          },
        },
      } as unknown as ApiClient,
      onAuthLost: () => undefined,
    })
    expect(await stored.loadDraft('session-1')).toBe('half typed')
  })

  test('saves a draft with no uploads and clears by scope', async () => {
    const calls: Call[] = []
    const api = apiOf({ calls, lost: [] })

    await api.saveDraft({ scope: 'session-1', text: 'hello' })
    await api.clearDraft('session-1')

    expect(calls).toEqual([
      { route: 'composerDrafts.put', input: { scope: 'session-1', text: 'hello', uploads: [] } },
      { route: 'composerDrafts.clear', input: { scope: 'session-1' } },
    ])
  })

  test('discards an upload by pathname and answers the operator by call id', async () => {
    const calls: Call[] = []
    const api = apiOf({ calls, lost: [] })

    await api.discardUpload('composer-uploads/a.png')
    await api.answerOperator({ sessionId: 'session-1', callId: 'call-1', value: 'yes' })

    expect(calls).toEqual([
      { route: 'composerUploads.discard', input: { pathname: 'composer-uploads/a.png' } },
      {
        route: 'operatorRequests.answer',
        input: { sessionId: 'session-1', callId: 'call-1', value: 'yes' },
      },
    ])
  })

  test('files tree and search go to their routes with the session id', async () => {
    const calls: Call[] = []
    const api = apiOf({ calls, lost: [] })

    await api.treeFiles({ sessionId: 'session-1', directory: 'src' })
    await api.searchFiles({ sessionId: 'session-1', query: 'index' })

    expect(calls).toEqual([
      { route: 'files.tree', input: { sessionId: 'session-1', directory: 'src' } },
      { route: 'files.search', input: { sessionId: 'session-1', query: 'index' } },
    ])
  })
})
