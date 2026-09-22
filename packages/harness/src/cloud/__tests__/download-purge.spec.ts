import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAuthKind,
  EAuthProvider,
  sanitiseRepoPath,
  type AccountSecret,
  type ClockPort,
} from '@dltech/atlas-core'

import { memoryAccountStore, type AccountStore } from '../../credentials/account-store'
import { SecretCipher } from '../../credentials/secret-cipher'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { CloudError } from '../cloud-client'
import { CloudService } from '../cloud-service'
import { CloudSessionStore } from '../cloud-session'
import { buildContextArchive } from '../context-archive'

const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

const URL = 'http://cloud.test'

const TIMESTAMP = '2026-01-01T00:00:00.000Z'

const accountRow = (args: {
  id: string
  provider: string
  label: string
  apiKey: string
  email?: string
}): Record<string, unknown> => ({
  id: args.id,
  provider: args.provider,
  kind: 'api-key',
  origin: 'login',
  label: args.label,
  status: 'active',
  ...(args.email === undefined ? {} : { email: args.email }),
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  secret: { kind: EAuthKind.ApiKey, apiKey: args.apiKey } satisfies AccountSecret,
})

type RemoteFake = {
  fetchFn: typeof fetch
  accounts: Map<string, Record<string, unknown>>
  actives: Map<string, string>
  secrets: Map<string, string>
  mcp: Map<string, Record<string, unknown>>
  memoryArchive: Uint8Array | null
  memoryBundle: string | null
  github: boolean
  failOn: string[]
  deleted: string[]
}

const remoteFake = (): RemoteFake => {
  const fake: RemoteFake = {
    accounts: new Map(),
    actives: new Map(),
    secrets: new Map(),
    mcp: new Map(),
    memoryArchive: null,
    memoryBundle: null,
    github: false,
    failOn: [],
    deleted: [],
    fetchFn: undefined as unknown as typeof fetch,
  }

  const reply = (status: number, payload?: unknown) =>
    new Response(payload === undefined ? null : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  fake.fetchFn = (async (input: unknown, init?: RequestInit) => {
    const path = String(input).slice(URL.length)
    const method = init?.method ?? 'GET'

    if (fake.failOn.some((fragment) => `${method} ${path}`.includes(fragment))) {
      return reply(500, { message: 'the cloud hiccuped' })
    }

    if (path === '/v1/accounts' && method === 'GET') {
      return reply(
        200,
        [...fake.accounts.values()].map((row) => {
          const { secret: _secret, ...account } = row
          return account
        }),
      )
    }
    if (path.startsWith('/v1/accounts/active/') && method === 'GET') {
      const provider = path.slice('/v1/accounts/active/'.length)
      return reply(200, { accountId: fake.actives.get(provider) ?? null })
    }
    if (path.startsWith('/v1/accounts/')) {
      const id = path.slice('/v1/accounts/'.length)
      if (method === 'GET') {
        const held = fake.accounts.get(id)
        return held === undefined ? reply(404, { message: 'no such account' }) : reply(200, held)
      }
      if (method === 'DELETE') {
        fake.accounts.delete(id)
        fake.deleted.push(path)
        return reply(204)
      }
    }

    if (path === '/v1/secrets' && method === 'GET') {
      return reply(200, {
        secrets: [...fake.secrets].map(([name, value]) => ({ name, value, updatedAt: TIMESTAMP })),
      })
    }
    if (path.startsWith('/v1/secrets/') && method === 'DELETE') {
      fake.secrets.delete(path.slice('/v1/secrets/'.length))
      fake.deleted.push(path)
      return reply(204)
    }

    if (path === '/v1/mcp-servers' && method === 'GET') {
      return reply(200, {
        servers: [...fake.mcp.values()].map((server) => ({ ...server, updatedAt: TIMESTAMP })),
      })
    }
    if (path.startsWith('/v1/mcp-servers/') && method === 'DELETE') {
      fake.mcp.delete(path.slice('/v1/mcp-servers/'.length))
      fake.deleted.push(path)
      return reply(204)
    }

    if (path === '/v1/user-context/memory') {
      const accept = new Headers(init?.headers).get('accept')
      if (method === 'GET' && accept === 'application/gzip') {
        if (fake.memoryArchive === null) return reply(404, { message: 'no memory archive stored yet' })
        return new Response(Buffer.from(fake.memoryArchive), {
          status: 200,
          headers: { 'content-type': 'application/gzip' },
        })
      }
      if (method === 'GET') return reply(200, { bundle: fake.memoryBundle })
      if (method === 'DELETE') {
        fake.memoryArchive = null
        fake.memoryBundle = null
        fake.deleted.push(path)
        return reply(204)
      }
    }

    if (path === '/v1/github' && method === 'GET') {
      return reply(
        200,
        fake.github
          ? { connected: true, login: 'octocat', scopes: ['repo'], connectedAt: TIMESTAMP }
          : { connected: false },
      )
    }
    if (path === '/v1/github' && method === 'DELETE') {
      fake.github = false
      fake.deleted.push(path)
      return reply(204)
    }

    return reply(404, { message: `unhandled ${method} ${path}` })
  }) as typeof fetch

  return fake
}

let directory: string
let sessions: CloudSessionStore
let local: AccountStore
let localSecrets: FileSecretsStore

const realAtlasHome = process.env['ATLAS_HOME']

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-download-purge-'))
  process.env['ATLAS_HOME'] = directory
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  local = memoryAccountStore({ clock })
  localSecrets = new FileSecretsStore({
    file: join(directory, 'secrets.json'),
    cipher: new SecretCipher(join(directory, 'key')),
  })
})

afterEach(() => {
  if (realAtlasHome === undefined) delete process.env['ATLAS_HOME']
  else process.env['ATLAS_HOME'] = realAtlasHome
  rmSync(directory, { recursive: true, force: true })
})

const signedInService = (fetchFn: typeof fetch): CloudService => {
  sessions.write({ url: URL, token: 'sess_purge', email: 'dev@example.com' })
  return new CloudService({ sessions, localAccounts: local, defaultUrl: URL, localSecrets, fetchFn })
}

const seedRemote = async (fake: RemoteFake): Promise<void> => {
  fake.accounts.set(
    'acc_cloud_1',
    accountRow({ id: 'acc_cloud_1', provider: EAuthProvider.Anthropic, label: 'work', apiKey: 'sk-a', email: 'w@example.com' }),
  )
  fake.accounts.set(
    'acc_cloud_2',
    accountRow({ id: 'acc_cloud_2', provider: EAuthProvider.OpenAI, label: 'personal', apiKey: 'sk-o' }),
  )
  fake.actives.set(EAuthProvider.Anthropic, 'acc_cloud_1')
  fake.actives.set(EAuthProvider.OpenAI, 'acc_cloud_2')
  fake.secrets.set('search.tavily', 'tvly-1')
  fake.secrets.set('search.exa', 'exa-1')
  fake.mcp.set('linear', { name: 'linear', transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' } })
  fake.mcp.set('paused', { name: 'paused', disabled: true })
  fake.memoryArchive = await buildContextArchive({
    files: [
      { key: 'user/MEMORY.md', path: join(directory, 'seed-user.md') },
      { key: `project/${encodeURIComponent('/repo/atlas')}/notes.md`, path: join(directory, 'seed-project.md') },
    ],
  }).then((archive) => {
    if (archive === undefined) throw new Error('expected an archive')
    return archive
  })
  fake.github = true
}

const seedMemoryFiles = (): void => {
  writeFileSync(join(directory, 'seed-user.md'), '# user memory')
  writeFileSync(join(directory, 'seed-project.md'), '# project memory')
}

describe('CloudService.downloadAndPurge', () => {
  it('lands every domain locally, deletes it remotely, and clears the session', async () => {
    const fake = remoteFake()
    seedMemoryFiles()
    await seedRemote(fake)
    writeFileSync(join(directory, 'auth.json.archived'), 'sentinel')
    const service = signedInService(fake.fetchFn)

    const result = await service.downloadAndPurge()

    expect(result).toEqual({
      accounts: 2,
      secrets: 2,
      mcpServers: 2,
      memoryFiles: 2,
      githubDisconnected: true,
    })

    const landed = await local.list()
    expect(landed).toHaveLength(2)
    expect(landed.map((account) => account.id)).not.toContain('acc_cloud_1')
    const work = landed.find((account) => account.provider === EAuthProvider.Anthropic)
    if (work === undefined) throw new Error('expected the anthropic account to land')
    expect(work.label).toBe('work')
    expect((await local.read(work.id))?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-a' })
    expect(await local.activeFor(EAuthProvider.Anthropic)).toBe(work.id)
    expect(await local.activeFor(EAuthProvider.OpenAI)).toBe(
      landed.find((account) => account.provider === EAuthProvider.OpenAI)?.id,
    )

    expect(localSecrets.read('search.tavily')).toBe('tvly-1')
    expect(localSecrets.read('search.exa')).toBe('exa-1')

    const mcp = JSON.parse(readFileSync(join(directory, 'mcp.json'), 'utf8')) as Record<string, unknown>
    expect(mcp['linear']).toEqual({ transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' } })
    expect(mcp['paused']).toEqual({ disabled: true })

    expect(readFileSync(join(directory, 'memory', 'MEMORY.md'), 'utf8')).toBe('# user memory')
    expect(
      readFileSync(
        join(directory, 'projects', sanitiseRepoPath('/repo/atlas'), 'memory', 'notes.md'),
        'utf8',
      ),
    ).toBe('# project memory')

    expect(fake.accounts.size).toBe(0)
    expect(fake.secrets.size).toBe(0)
    expect(fake.mcp.size).toBe(0)
    expect(fake.memoryArchive).toBeNull()
    expect(fake.github).toBe(false)
    expect(service.session()).toBeNull()

    expect(readFileSync(join(directory, 'auth.json.archived'), 'utf8')).toBe('sentinel')
  })

  it('never deletes a domain remotely when its download fails, and keeps the session', async () => {
    const fake = remoteFake()
    seedMemoryFiles()
    await seedRemote(fake)
    fake.failOn.push('GET /v1/accounts/acc_cloud_2')
    const service = signedInService(fake.fetchFn)

    const failure = await service.downloadAndPurge().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).message).toContain('the accounts step failed')
    expect((failure as CloudError).message).toContain('safe to retry')

    expect(await local.list()).toHaveLength(1)
    expect(fake.accounts.size).toBe(2)
    expect(fake.secrets.size).toBe(2)
    expect(fake.mcp.size).toBe(2)
    expect(fake.deleted).toEqual([])
    expect(service.session()).not.toBeNull()
  })

  it('completes cleanly on a second run after a partial failure, without duplicating accounts', async () => {
    const fake = remoteFake()
    seedMemoryFiles()
    await seedRemote(fake)
    fake.failOn.push('GET /v1/accounts/acc_cloud_2')
    const service = signedInService(fake.fetchFn)

    await service.downloadAndPurge().catch(() => undefined)
    fake.failOn.length = 0
    const result = await service.downloadAndPurge()

    expect(result.accounts).toBe(2)
    expect(await local.list()).toHaveLength(2)
    expect(fake.accounts.size).toBe(0)
    expect(fake.secrets.size).toBe(0)
    expect(service.session()).toBeNull()
  })

  it('leaves the archived siblings of a prior sign-in alone', async () => {
    const fake = remoteFake()
    const service = signedInService(fake.fetchFn)
    writeFileSync(join(directory, 'secrets.json.archived'), 'old secrets')
    writeFileSync(join(directory, 'mcp.json.archived'), 'old mcp')

    await service.downloadAndPurge()

    expect(readFileSync(join(directory, 'secrets.json.archived'), 'utf8')).toBe('old secrets')
    expect(readFileSync(join(directory, 'mcp.json.archived'), 'utf8')).toBe('old mcp')
  })

  it('skips the github delete when nothing is connected, and still signs out', async () => {
    const fake = remoteFake()
    const service = signedInService(fake.fetchFn)

    const result = await service.downloadAndPurge()

    expect(result.githubDisconnected).toBe(false)
    expect(fake.deleted).not.toContain('/v1/github')
    expect(service.session()).toBeNull()
  })

  it('refuses to run without a session', async () => {
    const service = new CloudService({
      sessions,
      localAccounts: local,
      defaultUrl: URL,
      localSecrets,
      fetchFn: remoteFake().fetchFn,
    })

    const failure = await service.downloadAndPurge().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).message).toContain('sign in first')
    expect(existsSync(join(directory, 'mcp.json'))).toBe(false)
  })
})
