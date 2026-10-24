import { describe, expect, it } from 'bun:test'

import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-core'

import { CloudUserFilesClient, UserFileConflict } from '../user-files-client'

type Call = { url: string; method: string; body: unknown }
type Answer = { status: number; body?: unknown }

const answerOf = (answer: Answer): Response =>
  answer.status < 400
    ? Response.json({ result: { data: answer.body ?? null } })
    : Response.json(
        {
          error: {
            message: 'refused',
            code: -32603,
            data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: answer.status },
          },
        },
        { status: answer.status },
      )

const clientWith = (
  respond: (call: Call) => Answer,
  extra?: { log?: { port: LogPort }; delays?: number[] },
) => {
  const calls: Call[] = []
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    return answerOf(respond(call))
  }) as typeof fetch
  return {
    client: new CloudUserFilesClient({
      url: 'http://cloud.test/',
      token: 't',
      fetchFn,
      log: extra?.log,
      sleep: async (ms) => {
        extra?.delays?.push(ms)
      },
      randomFn: () => 1,
    }),
    calls,
  }
}

const meta = (revision: number, contentHash = 'h') => ({
  path: 'user/a.md',
  revision,
  contentHash,
  tombstonedAt: null,
})

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

describe('CloudUserFilesClient', () => {
  it('lists a tree and decodes base64 content on batch get', async () => {
    const { client, calls } = clientWith((call) =>
      call.method === 'GET'
        ? { status: 200, body: { files: [meta(2)] } }
        : {
            status: 200,
            body: { files: [{ ...meta(2), content: Buffer.from('hi').toString('base64') }] },
          },
    )

    expect((await client.listUserFiles({ tree: 'memory' }))[0]?.revision).toBe(2)
    const [file] = await client.getUserFiles({ tree: 'memory', paths: ['user/a.md'] })

    expect(Buffer.from(file?.content ?? new Uint8Array()).toString()).toBe('hi')
    const input = new URL(calls[0]?.url ?? '').searchParams.get('input')
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/v1/trpc/userFiles.list')
    expect(JSON.parse(input ?? '')).toEqual({ tree: 'memory' })
    expect(calls[1]?.url).toBe('http://cloud.test/v1/trpc/userFiles.get')
    expect(calls[1]?.body).toEqual({ tree: 'memory', paths: ['user/a.md'] })
  })

  it('passes sinceRevision to the list query', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: { files: [] } }))

    await client.listUserFiles({ tree: 'skills', sinceRevision: 4 })

    const input = new URL(calls[0]?.url ?? '').searchParams.get('input')
    expect(JSON.parse(input ?? '')).toEqual({ tree: 'skills', sinceRevision: 4 })
  })

  it('puts the raw path with base64 content and the base revision', async () => {
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

    expect(calls[0]?.url).toBe('http://cloud.test/v1/trpc/userFiles.put')
    expect(calls[0]?.body).toEqual({
      tree: 'skills',
      path: '.atlas/my skill/SKILL.md',
      content: 'aGk=',
      contentHash: 'h',
      baseRevision: 2,
    })
  })

  it('removes with the base revision', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: { revision: 5 } }))

    await expect(
      client.deleteUserFile({ tree: 'memory', path: 'user/a.md', baseRevision: 4 }),
    ).resolves.toEqual({ revision: 5 })

    expect(calls[0]?.url).toBe('http://cloud.test/v1/trpc/userFiles.remove')
    expect(calls[0]?.body).toEqual({ tree: 'memory', path: 'user/a.md', baseRevision: 4 })
  })

  it('surfaces a 409 as a typed conflict carrying the current revision and hash', async () => {
    const { client } = clientWith((call) =>
      call.method === 'GET'
        ? { status: 200, body: { files: [meta(7, 'remote')] } }
        : { status: 409 },
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

  it('retries the batch get mutation on a retryable status', async () => {
    const delays: number[] = []
    const log = new RecordingLog()
    let attempts = 0
    const { client, calls } = clientWith(
      () => {
        attempts += 1
        return attempts < 3
          ? { status: 503 }
          : { status: 200, body: { files: [{ ...meta(1), content: null }] } }
      },
      { delays, log: { port: log } },
    )

    const files = await client.getUserFiles({ tree: 'memory', paths: ['user/a.md'] })

    expect(files).toHaveLength(1)
    expect(calls).toHaveLength(3)
    expect(delays).toEqual([500, 1000])
    expect(log.entries.filter((entry) => entry.severity === ELogSeverity.Warn)).toHaveLength(2)
  })

  it('gives up on the batch get after the default attempts', async () => {
    const { client, calls } = clientWith(() => ({ status: 503 }))

    await expect(
      client.getUserFiles({ tree: 'memory', paths: ['user/a.md'] }),
    ).rejects.toMatchObject({ status: 503 })

    expect(calls).toHaveLength(4)
  })

  it('does not retry the batch get on a non-retryable status', async () => {
    const { client, calls } = clientWith(() => ({ status: 403 }))

    await expect(
      client.getUserFiles({ tree: 'memory', paths: ['user/a.md'] }),
    ).rejects.toMatchObject({ status: 403 })

    expect(calls).toHaveLength(1)
  })
})
