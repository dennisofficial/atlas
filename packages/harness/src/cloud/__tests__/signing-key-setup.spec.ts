import { describe, expect, it } from 'bun:test'
import { GITHUB_NOT_CONNECTED_CODE, SSH_SIGNING_SCOPE_MISSING_CODE } from '@dltech/atlas-wire'

import { SigningKeyClient } from '../signing-key-client'
import {
  ESigningKeyOutcome,
  ensureSigningKey,
  removeSigningKey,
  rotateSigningKey,
} from '../signing-key-setup'

type Reply = { status: number; body?: unknown; code?: string; networkError?: boolean }
type Replies = Partial<Record<string, Reply>>

const answer = (reply: Reply): Response =>
  reply.status < 400
    ? Response.json({ result: { data: reply.body ?? null } })
    : Response.json(
        {
          error: {
            message: 'refused',
            code: -32603,
            data: {
              code: 'FORBIDDEN',
              httpStatus: reply.status,
              ...(reply.code === undefined ? {} : { details: { code: reply.code } }),
            },
          },
        },
        { status: reply.status },
      )

const absent: Reply = { status: 200, body: { state: 'absent' } }
const registered: Reply = {
  status: 200,
  body: {
    state: 'registered',
    publicKey: 'ssh-ed25519 AAAA',
    createdAt: '2026-10-19T00:00:00.000Z',
  },
}

const fakeApi = (args: { replies: Replies }) => {
  const calls: { key: string; body: unknown }[] = []
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const key = new URL(String(input)).pathname.replace('/v1/trpc/', '')
    calls.push({ key, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    const reply = args.replies[key] ?? { status: 200 }
    if (reply.networkError === true) throw new Error('connection reset')
    return answer(reply)
  }) as typeof fetch
  const client = new SigningKeyClient({
    url: 'https://cloud.test',
    token: 'sess_1',
    fetchFn,
    sleep: async () => undefined,
  })
  return { client, calls }
}

const keys = (calls: { key: string }[]): string[] => calls.map((call) => call.key)

describe('ensureSigningKey', () => {
  it('generates and registers a key when none exists', async () => {
    const api = fakeApi({
      replies: {
        'sshSigningKey.status': absent,
        'sshSigningKey.register': registered,
      },
    })

    const outcome = await ensureSigningKey({ client: api.client, comment: 'atlas@octo' })

    expect(outcome).toBe(ESigningKeyOutcome.Registered)
    expect(keys(api.calls)).toEqual(['sshSigningKey.status', 'sshSigningKey.register'])
    const posted = api.calls[1]?.body as { privateKey: string }
    expect(posted.privateKey).toStartWith('-----BEGIN OPENSSH PRIVATE KEY-----')
  })

  it('does not register when a key already exists', async () => {
    const api = fakeApi({ replies: { 'sshSigningKey.status': registered } })

    expect(await ensureSigningKey({ client: api.client, comment: 'c' })).toBe(
      ESigningKeyOutcome.AlreadyRegistered,
    )
    expect(keys(api.calls)).toEqual(['sshSigningKey.status'])
  })

  it('reports AlreadyRegistered when another machine wins the register race', async () => {
    const api = fakeApi({
      replies: {
        'sshSigningKey.status': absent,
        'sshSigningKey.register': { status: 409 },
      },
    })

    expect(await ensureSigningKey({ client: api.client, comment: 'c' })).toBe(
      ESigningKeyOutcome.AlreadyRegistered,
    )
  })

  it('maps the scope code to ScopeMissing', async () => {
    const api = fakeApi({
      replies: {
        'sshSigningKey.status': absent,
        'sshSigningKey.register': { status: 403, code: SSH_SIGNING_SCOPE_MISSING_CODE },
      },
    })

    expect(await ensureSigningKey({ client: api.client, comment: 'c' })).toBe(
      ESigningKeyOutcome.ScopeMissing,
    )
  })

  it('maps the not-connected code to GithubNotConnected even on a 409', async () => {
    const api = fakeApi({
      replies: {
        'sshSigningKey.status': absent,
        'sshSigningKey.register': { status: 409, code: GITHUB_NOT_CONNECTED_CODE },
      },
    })

    expect(await ensureSigningKey({ client: api.client, comment: 'c' })).toBe(
      ESigningKeyOutcome.GithubNotConnected,
    )
  })

  it('is Unavailable for a 5xx, a network failure and a malformed status, and never throws', async () => {
    const cases: Replies[] = [
      { 'sshSigningKey.status': { status: 500 } },
      { 'sshSigningKey.status': { status: 200, networkError: true } },
      { 'sshSigningKey.status': { status: 200, body: { state: 'mystery' } } },
      { 'sshSigningKey.status': absent, 'sshSigningKey.register': { status: 503 } },
    ]

    for (const replies of cases) {
      const api = fakeApi({ replies })
      expect(await ensureSigningKey({ client: api.client, comment: 'c' })).toBe(
        ESigningKeyOutcome.Unavailable,
      )
    }
  })
})

describe('rotateSigningKey', () => {
  it('posts a fresh key to the rotate route', async () => {
    const api = fakeApi({ replies: { 'sshSigningKey.rotate': registered } })

    expect(await rotateSigningKey({ client: api.client, comment: 'atlas@octo' })).toBe(
      ESigningKeyOutcome.Rotated,
    )
    expect(keys(api.calls)).toEqual(['sshSigningKey.rotate'])
  })

  it('maps scope, not-connected, missing key and outages', async () => {
    const outcomeFor = async (reply: Reply): Promise<ESigningKeyOutcome> => {
      const api = fakeApi({ replies: { 'sshSigningKey.rotate': reply } })
      return rotateSigningKey({ client: api.client, comment: 'c' })
    }

    expect(await outcomeFor({ status: 403, code: SSH_SIGNING_SCOPE_MISSING_CODE })).toBe(
      ESigningKeyOutcome.ScopeMissing,
    )
    expect(await outcomeFor({ status: 409, code: GITHUB_NOT_CONNECTED_CODE })).toBe(
      ESigningKeyOutcome.GithubNotConnected,
    )
    expect(await outcomeFor({ status: 404 })).toBe(ESigningKeyOutcome.Unavailable)
    expect(await outcomeFor({ status: 409 })).toBe(ESigningKeyOutcome.Unavailable)
    expect(await outcomeFor({ status: 200, networkError: true })).toBe(
      ESigningKeyOutcome.Unavailable,
    )
  })
})

describe('removeSigningKey', () => {
  it('deletes the key', async () => {
    const api = fakeApi({ replies: { 'sshSigningKey.revoke': { status: 200 } } })

    expect(await removeSigningKey({ client: api.client })).toBe(ESigningKeyOutcome.Removed)
    expect(keys(api.calls)).toEqual(['sshSigningKey.revoke'])
  })

  it('is Unavailable when the API fails, and never throws', async () => {
    const failing = fakeApi({ replies: { 'sshSigningKey.revoke': { status: 500 } } })
    const offline = fakeApi({
      replies: { 'sshSigningKey.revoke': { status: 200, networkError: true } },
    })

    expect(await removeSigningKey({ client: failing.client })).toBe(ESigningKeyOutcome.Unavailable)
    expect(await removeSigningKey({ client: offline.client })).toBe(ESigningKeyOutcome.Unavailable)
  })
})
