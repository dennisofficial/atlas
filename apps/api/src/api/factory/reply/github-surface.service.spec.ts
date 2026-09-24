import { generateKeyPairSync } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import type { EnvService } from '../../../_core/config/env/env.service'
import type { GithubFetch } from './github-api'
import { GithubSurfaceService } from './github-surface.service'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

type Call = {
  url: string
  method: string
  authorization: string | undefined
  accept: string | undefined
  body: unknown
}

const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const textResponse = (status: number, payload: string): Response =>
  new Response(payload, { status, headers: { 'content-type': 'text/plain' } })

function fakeEnv(): EnvService {
  return {
    get: (key: string) => {
      if (key === 'GITHUB_APP_ID') return '123456'
      if (key === 'GITHUB_APP_PRIVATE_KEY') return PRIVATE_PEM
      return undefined
    },
  } as unknown as EnvService
}

function fakeFetch(handlers: Record<string, (call: Call) => Response>): {
  fetchFn: GithubFetch
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      authorization: headers?.authorization,
      accept: headers?.accept,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    }
    calls.push(call)
    const handler = handlers[`${call.method} ${call.url}`]
    if (handler === undefined) return jsonResponse(404, { message: 'not found' })
    return handler(call)
  }) as GithubFetch
  return { fetchFn, calls }
}

const AUTH = {
  'GET https://api.github.com/repos/compai/atlas/installation': () => jsonResponse(200, { id: 42 }),
  'POST https://api.github.com/app/installations/42/access_tokens': () =>
    jsonResponse(201, { token: 'ghs_installation_token' }),
}

function surfaceWith(handlers: Record<string, (call: Call) => Response>): {
  service: GithubSurfaceService
  calls: Call[]
} {
  const { fetchFn, calls } = fakeFetch({ ...AUTH, ...handlers })
  return { service: new GithubSurfaceService(fakeEnv(), fetchFn), calls }
}

const lastCall = (calls: Call[]): Call => calls[calls.length - 1] as Call

describe('GithubSurfaceService', () => {
  it('getIssue reads the issue as the installation and maps labels to names', async () => {
    const { service, calls } = surfaceWith({
      'GET https://api.github.com/repos/compai/atlas/issues/341': () =>
        jsonResponse(200, {
          number: 341,
          title: 'reply loop',
          body: 'it loops',
          state: 'open',
          labels: [{ name: 'bug' }, { name: 'factory' }],
          html_url: 'https://github.com/compai/atlas/issues/341',
        }),
    })

    const issue = await service.getIssue({ owner: 'compai', repo: 'atlas', number: 341 })

    expect(issue).toEqual({
      number: 341,
      title: 'reply loop',
      body: 'it loops',
      state: 'open',
      labels: ['bug', 'factory'],
      url: 'https://github.com/compai/atlas/issues/341',
    })
    const call = lastCall(calls)
    expect(call.method).toBe('GET')
    expect(call.authorization).toBe('Bearer ghs_installation_token')
  })

  it('getIssueComments caps at 50 and maps author and timestamps', async () => {
    const { service, calls } = surfaceWith({
      'GET https://api.github.com/repos/compai/atlas/issues/341/comments?per_page=50': () =>
        jsonResponse(200, [
          { user: { login: 'dennis' }, body: 'first', created_at: '2026-09-24T10:00:00Z' },
        ]),
    })

    const comments = await service.getIssueComments({ owner: 'compai', repo: 'atlas', number: 341 })

    expect(comments).toEqual([
      { author: 'dennis', body: 'first', createdAt: '2026-09-24T10:00:00Z' },
    ])
    expect(lastCall(calls).url).toContain('per_page=50')
  })

  it('getPullRequest reads the pull and maps refs and diff stats', async () => {
    const { service, calls } = surfaceWith({
      'GET https://api.github.com/repos/compai/atlas/pulls/57': () =>
        jsonResponse(200, {
          number: 57,
          title: 'fix loop',
          body: null,
          state: 'open',
          draft: true,
          head: { ref: 'factory/fix-loop' },
          base: { ref: 'main' },
          html_url: 'https://github.com/compai/atlas/pull/57',
          changed_files: 3,
          additions: 40,
          deletions: 12,
        }),
    })

    const pr = await service.getPullRequest({ owner: 'compai', repo: 'atlas', number: 57 })

    expect(pr).toEqual({
      number: 57,
      title: 'fix loop',
      body: null,
      state: 'open',
      draft: true,
      headRef: 'factory/fix-loop',
      baseRef: 'main',
      url: 'https://github.com/compai/atlas/pull/57',
      changedFiles: 3,
      additions: 40,
      deletions: 12,
    })
    expect(lastCall(calls).authorization).toBe('Bearer ghs_installation_token')
  })

  it('getPullRequestDiff negotiates the diff media type and returns raw text', async () => {
    const diff = 'diff --git a/a.ts b/a.ts\n+line\n'
    const { service, calls } = surfaceWith({
      'GET https://api.github.com/repos/compai/atlas/pulls/57': () => textResponse(200, diff),
    })

    expect(await service.getPullRequestDiff({ owner: 'compai', repo: 'atlas', number: 57 })).toBe(
      diff,
    )
    expect(lastCall(calls).accept).toBe('application/vnd.github.v3.diff')
  })

  it('getPullRequestDiff caps at 50000 characters with a truncation marker', async () => {
    const { service } = surfaceWith({
      'GET https://api.github.com/repos/compai/atlas/pulls/57': () =>
        textResponse(200, 'x'.repeat(60_000)),
    })

    const diff = await service.getPullRequestDiff({ owner: 'compai', repo: 'atlas', number: 57 })

    expect(diff.startsWith('x'.repeat(50_000))).toBe(true)
    expect(diff).toContain('[diff truncated at 50000 characters]')
  })

  it('closeIssue posts the comment before patching the issue closed', async () => {
    const { service, calls } = surfaceWith({
      'POST https://api.github.com/repos/compai/atlas/issues/341/comments': () =>
        jsonResponse(201, { html_url: 'https://github.com/compai/atlas/issues/341#issuecomment-9' }),
      'PATCH https://api.github.com/repos/compai/atlas/issues/341': () =>
        jsonResponse(200, { html_url: 'https://github.com/compai/atlas/issues/341' }),
    })

    const closed = await service.closeIssue({
      owner: 'compai',
      repo: 'atlas',
      number: 341,
      body: 'closing as duplicate of #12',
    })

    expect(closed.url).toBe('https://github.com/compai/atlas/issues/341')
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET https://api.github.com/repos/compai/atlas/installation',
      'POST https://api.github.com/app/installations/42/access_tokens',
      'POST https://api.github.com/repos/compai/atlas/issues/341/comments',
      'PATCH https://api.github.com/repos/compai/atlas/issues/341',
    ])
    expect(calls[2]?.body).toEqual({ body: 'closing as duplicate of #12' })
    expect(calls[3]?.body).toEqual({ state: 'closed' })
  })

  it('addLabel posts the label list to the issue labels endpoint', async () => {
    const { service, calls } = surfaceWith({
      'POST https://api.github.com/repos/compai/atlas/issues/341/labels': () =>
        jsonResponse(200, [{ name: 'ready-for-agent' }]),
    })

    await service.addLabel({ owner: 'compai', repo: 'atlas', number: 341, label: 'ready-for-agent' })

    const call = lastCall(calls)
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ labels: ['ready-for-agent'] })
    expect(call.authorization).toBe('Bearer ghs_installation_token')
  })

  it('removeLabel deletes the label by name', async () => {
    const { service, calls } = surfaceWith({
      'DELETE https://api.github.com/repos/compai/atlas/issues/341/labels/ready-for-agent': () =>
        jsonResponse(200, []),
    })

    await service.removeLabel({
      owner: 'compai',
      repo: 'atlas',
      number: 341,
      label: 'ready-for-agent',
    })

    expect(lastCall(calls).method).toBe('DELETE')
  })

  it('removeLabel treats a 404 as already absent', async () => {
    const { service } = surfaceWith({})

    await expect(
      service.removeLabel({ owner: 'compai', repo: 'atlas', number: 341, label: 'ghost' }),
    ).resolves.toBeUndefined()
  })

  it('a github failure carries the status and detail', async () => {
    const { service } = surfaceWith({
      'GET https://api.github.com/repos/compai/atlas/issues/341': () =>
        jsonResponse(500, { message: 'boom' }),
    })

    const attempt = service.getIssue({ owner: 'compai', repo: 'atlas', number: 341 })
    await expect(attempt).rejects.toBeInstanceOf(BadGatewayException)
    await expect(attempt).rejects.toThrow('500')
    await expect(attempt).rejects.toThrow('boom')
  })
})
