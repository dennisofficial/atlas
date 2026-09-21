import { generateKeyPairSync } from 'node:crypto'
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvService } from '../../../_core/config/env/env.service'
import { GithubAppNotInstalled, GithubAppService, type GithubFetch } from './github-app.service'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

type Call = { url: string; method: string; authorization: string | undefined; body: unknown }

const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function fakeEnv(args: { configured: boolean }): EnvService {
  return {
    get: (key: string) => {
      if (!args.configured) return undefined
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
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    }
    calls.push(call)
    const handler = handlers[`${call.method} ${call.url}`]
    if (handler === undefined) return jsonResponse(404, { message: 'not found' })
    return handler(call)
  }) as GithubFetch
  return { fetchFn, calls }
}

const HAPPY = {
  'GET https://api.github.com/repos/compai/atlas/installation': () => jsonResponse(200, { id: 42 }),
  'POST https://api.github.com/app/installations/42/access_tokens': () =>
    jsonResponse(201, { token: 'ghs_installation_token' }),
  'POST https://api.github.com/repos/compai/atlas/issues/341/comments': () =>
    jsonResponse(201, { html_url: 'https://github.com/compai/atlas/issues/341#issuecomment-1' }),
}

describe('GithubAppService', () => {
  let service: GithubAppService

  describe('configured', () => {
    beforeEach(() => {
      const { fetchFn } = fakeFetch(HAPPY)
      service = new GithubAppService(fakeEnv({ configured: true }), fetchFn)
    })

    it('mints an installation token per call and posts the comment as the installation', async () => {
      const { fetchFn, calls } = fakeFetch(HAPPY)
      service = new GithubAppService(fakeEnv({ configured: true }), fetchFn)

      const posted = await service.createComment({
        owner: 'compai',
        repo: 'atlas',
        issueNumber: 341,
        body: 'triage: looking at this',
      })

      expect(posted.url).toBe('https://github.com/compai/atlas/issues/341#issuecomment-1')
      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        'GET https://api.github.com/repos/compai/atlas/installation',
        'POST https://api.github.com/app/installations/42/access_tokens',
        'POST https://api.github.com/repos/compai/atlas/issues/341/comments',
      ])
      const [lookup, mint, comment] = calls as [Call, Call, Call]
      expect(lookup.authorization).toMatch(/^Bearer .+\..+\..+$/)
      expect(mint.authorization).toBe(lookup.authorization)
      expect(comment.authorization).toBe('Bearer ghs_installation_token')
      expect(comment.body).toEqual({ body: 'triage: looking at this' })
    })

    it('resolves the bot login from the app slug, lowercased and cached', async () => {
      const { fetchFn, calls } = fakeFetch({
        'GET https://api.github.com/app': () => jsonResponse(200, { slug: 'Atlas-Factory' }),
      })
      service = new GithubAppService(fakeEnv({ configured: true }), fetchFn)

      expect(await service.botLogin()).toBe('atlas-factory[bot]')
      expect(await service.botLogin()).toBe('atlas-factory[bot]')
      expect(calls).toHaveLength(1)
    })

    it('mints the app jwt itself rather than trusting github to skip auth', async () => {
      const { fetchFn, calls } = fakeFetch({
        'POST https://api.github.com/app/installations/42/access_tokens': () =>
          jsonResponse(201, { token: 'ghs_installation_token' }),
        'GET https://api.github.com/repos/compai/atlas/installation': (call) => {
          const jwt = (call.authorization ?? '').replace('Bearer ', '')
          const payload = JSON.parse(
            Buffer.from(jwt.split('.')[1] as string, 'base64url').toString('utf8'),
          ) as { iss: string }
          expect(payload.iss).toBe('123456')
          return jsonResponse(200, { id: 42 })
        },
      })
      service = new GithubAppService(fakeEnv({ configured: true }), fetchFn)

      await service.installationToken({ owner: 'compai', repo: 'atlas' })
      expect(calls).toHaveLength(2)
    })

    it('a missing installation is its own refusal, naming the repo the model asked about', async () => {
      const { fetchFn } = fakeFetch({})
      service = new GithubAppService(fakeEnv({ configured: true }), fetchFn)

      await expect(
        service.installationToken({ owner: 'compai', repo: 'uninstalled' }),
      ).rejects.toThrow('the factory github app is not installed on compai/uninstalled')
      await expect(
        service.installationToken({ owner: 'compai', repo: 'uninstalled' }),
      ).rejects.toBeInstanceOf(GithubAppNotInstalled)
    })

    it('a github failure carries the status and detail', async () => {
      const { fetchFn } = fakeFetch({
        'GET https://api.github.com/repos/compai/atlas/installation': () =>
          jsonResponse(403, { message: 'rate limited' }),
      })
      service = new GithubAppService(fakeEnv({ configured: true }), fetchFn)

      await expect(
        service.installationToken({ owner: 'compai', repo: 'atlas' }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      await expect(
        service.installationToken({ owner: 'compai', repo: 'atlas' }),
      ).rejects.toThrow('403')
    })
  })

  describe('unconfigured', () => {
    beforeEach(() => {
      service = new GithubAppService(fakeEnv({ configured: false }), vi.fn() as GithubFetch)
    })

    it('reports not configured', () => {
      expect(service.configured()).toBe(false)
    })

    it('never filters ingress on a bot login it cannot know', async () => {
      expect(await service.botLogin()).toBeNull()
    })

    it('refuses to mint tokens', async () => {
      await expect(
        service.installationToken({ owner: 'compai', repo: 'atlas' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException)
    })
  })
})
