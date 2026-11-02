import { generateKeyPairSync } from 'node:crypto'
import { EnvService } from '../../../_core/config/env/env.service'
import type { RedisService } from '../../../_lib/redis/redis.service'
import { GithubAppClient } from './github-app-client'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubAppSyncGate } from './github-app-sync-gate'
import { GithubAppSyncService } from './github-app-sync.service'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

export const TEST_APP_PUBLIC_KEY = publicKey

export type FakeInstallation = {
  id: number
  login: string
  suspended?: boolean
  repos: string[]
}

export function fakeGithubApp(args: { installations: FakeInstallation[] }) {
  const original = globalThis.fetch
  const calls: string[] = []
  const state = { installations: args.installations }
  globalThis.fetch = (async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(
      typeof target === 'string' ? target : target instanceof URL ? target.href : target.url,
    )
    if (url.hostname !== 'api.github.com') return original(target, init)
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    if (url.pathname === '/app/installations') {
      return Response.json(
        state.installations.map((item) => ({
          id: item.id,
          account: { login: item.login, type: 'User' },
          suspended_at: item.suspended === true ? '2026-11-01T00:00:00Z' : null,
        })),
      )
    }
    const minted = url.pathname.match(/^\/app\/installations\/(\d+)\/access_tokens$/)
    if (minted !== null) return Response.json({ token: `inst-${minted[1]}` })
    if (url.pathname === '/installation/repositories') {
      const id = new Headers(init?.headers).get('authorization')?.replace('Bearer inst-', '')
      const found = state.installations.find((item) => String(item.id) === id)
      const page = Number(url.searchParams.get('page'))
      const slice = (found?.repos ?? []).slice((page - 1) * 100, page * 100)
      return Response.json({
        repositories: slice.map((full_name) => ({ full_name })),
      })
    }
    return Response.json({}, { status: 404 })
  }) as typeof fetch
  return {
    calls,
    state,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

export function syncServiceWith() {
  const env = new EnvService({
    GITHUB_APP_ID: '4242',
    GITHUB_APP_PRIVATE_KEY: privateKey,
  })
  const client = new GithubAppClient(env)
  const installations = new GithubAppInstallationsService()
  const redis = { isConfigured: () => false } as unknown as RedisService
  const service = new GithubAppSyncService(client, installations, new GithubAppSyncGate(redis))
  return { client, installations, service }
}
