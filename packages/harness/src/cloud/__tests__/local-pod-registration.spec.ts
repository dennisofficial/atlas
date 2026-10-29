import { describe, expect, it } from 'bun:test'

import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { CloudError } from '../cloud-transport'
import { readLocalPodCheckpoint, registerLocalPodThread } from '../local-pod-registration'

type Seen = { url: string; method: string | undefined; auth: string | null; body: unknown }

const failure = (args: { status: number; code: string }): Response =>
  Response.json(
    { error: { message: 'no', code: -32603, data: { code: args.code, httpStatus: args.status } } },
    { status: args.status },
  )

const recording = (reply: () => Response) => {
  const seen: Seen[] = []
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method,
      auth: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    return reply()
  }) as typeof fetch
  return { seen, fetchFn }
}

const CHECKPOINT: RuntimeCheckpoint = {
  threadId: 'brn_pod',
  runtimeId: 'runtime-1',
  sandboxSessionId: 'atlas-pod-brn_pod',
  revision: 3,
  phase: ERuntimePhase.Parked,
  reportedAt: '2026-10-28T00:00:00.000Z',
  transcript: { head: 0, count: 0, digest: '0'.repeat(64) },
}

const register = (fetchFn: typeof fetch) =>
  registerLocalPodThread({
    url: 'https://cloud.test',
    sessionToken: 'sess_1',
    clientVersion: '1.2.3',
    threadId: 'brn_pod',
    projectId: 'proj_1',
    model: 'claude-x',
    effort: 'high',
    fetchFn,
  })

const read = (fetchFn: typeof fetch) =>
  readLocalPodCheckpoint({
    url: 'https://cloud.test',
    sessionToken: 'sess_1',
    clientVersion: '1.2.3',
    threadId: 'brn_pod',
    fetchFn,
  })

describe('registerLocalPodThread', () => {
  it('creates the thread under its own id with the owner session and no first message', async () => {
    const { seen, fetchFn } = recording(() =>
      Response.json({ result: { data: { id: 'brn_pod' } } }),
    )

    await register(fetchFn)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('https://cloud.test/v1/trpc/threads.create')
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.auth).toBe('Bearer sess_1')
    expect(seen[0]?.body).toEqual({
      id: 'brn_pod',
      projectId: 'proj_1',
      model: 'claude-x',
      effort: 'high',
    })
  })

  it('omits a null project', async () => {
    const { seen, fetchFn } = recording(() => Response.json({ result: { data: null } }))

    await registerLocalPodThread({
      url: 'https://cloud.test',
      sessionToken: 'sess_1',
      clientVersion: '1.2.3',
      threadId: 'brn_pod',
      projectId: null,
      fetchFn,
    })

    expect(seen[0]?.body).toEqual({ id: 'brn_pod' })
  })

  it('treats an already-registered thread as done', async () => {
    const { fetchFn } = recording(() => failure({ status: 409, code: 'CONFLICT' }))

    await expect(register(fetchFn)).resolves.toBeUndefined()
  })

  it('rethrows any other failure', async () => {
    const { fetchFn } = recording(() => failure({ status: 401, code: 'UNAUTHORIZED' }))

    const error: unknown = await register(fetchFn).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CloudError)
    expect(error).toMatchObject({ status: 401 })
  })
})

describe('readLocalPodCheckpoint', () => {
  it('reads the mirrored checkpoint through localPodCheckpoint.get with the owner session', async () => {
    const { seen, fetchFn } = recording(() =>
      Response.json({ result: { data: { checkpoint: CHECKPOINT } } }),
    )

    expect(await read(fetchFn)).toEqual(CHECKPOINT)
    expect(seen[0]?.url).toStartWith('https://cloud.test/v1/trpc/localPodCheckpoint.get')
    expect(seen[0]?.method).toBe('GET')
    expect(seen[0]?.auth).toBe('Bearer sess_1')
  })

  it('answers null when nothing is stored', async () => {
    const { fetchFn } = recording(() => failure({ status: 404, code: 'NOT_FOUND' }))

    expect(await read(fetchFn)).toBeNull()
  })

  it('answers null on a malformed reply', async () => {
    const { fetchFn } = recording(() =>
      Response.json({ result: { data: { checkpoint: { nope: true } } } }),
    )

    expect(await read(fetchFn)).toBeNull()
  })
})
