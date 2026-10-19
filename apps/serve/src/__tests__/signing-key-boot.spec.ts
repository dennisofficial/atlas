import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { EWorkspaceState, startServe, type ServeHandle, type WorkspaceFiles } from '../index'

import { fakeServeApp } from './fakes'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-serve')
const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n'
const lease = {
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLIC',
  privateKey: PEM,
  userName: 'octocat',
  userEmail: '583231+octocat@users.noreply.github.com',
}

const running: ServeHandle[] = []
const homes: string[] = []
let heldAtlasHome: string | undefined

const inMemoryContextFiles = (): WorkspaceFiles => {
  const stored = new Map<string, string>()
  return {
    exists: async (path) => stored.has(path),
    read: async (path) => {
      const text = stored.get(path)
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
    write: async ({ path, text }) => {
      stored.set(path, text)
    },
    writeBytes: async ({ path, bytes }) => {
      stored.set(path, bytes.toString('utf8'))
    },
    ensureDirectory: async () => undefined,
    empty: async () => undefined,
  }
}

const requestOf = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Request =>
  input instanceof Request ? new Request(input, init) : new Request(String(input), init)

const controlPlane = (args: { leaseStatus: number }): typeof fetch =>
  Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = requestOf(input, init)
    const isLease = request.method === 'GET' && new URL(request.url).pathname === '/v1/ssh-signing-key'
    if (!isLease) return new Response(null, { status: 204 })
    if (args.leaseStatus === 200) return Response.json(lease)
    return new Response(null, { status: args.leaseStatus })
  }, { preconnect: () => undefined })

const start = async (args: {
  env: Record<string, string | undefined>
  leaseStatus: number
}): Promise<string> => {
  const atlasHome = mkdtempSync(join(tmpdir(), 'atlas-signing-key-boot-spec-'))
  homes.push(atlasHome)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: 'https://api.example.com',
    env: args.env,
    cwd: '/workspace',
    compose: async () => fakeServeApp({ threadId, root: '/workspace' }),
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: inMemoryContextFiles(),
    fetchFn: controlPlane({ leaseStatus: args.leaseStatus }),
  })
  running.push(handle)
  return atlasHome
}

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

describe('serve boot signing key', () => {
  it('writes the key at mode 600 and arms git signing for child processes', async () => {
    const env: Record<string, string | undefined> = {}

    const atlasHome = await start({ env, leaseStatus: 200 })

    const keyPath = join(atlasHome, 'ssh-signing-key')
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
    expect(readFileSync(keyPath, 'utf8')).toBe(PEM)
    expect(readFileSync(join(atlasHome, 'ssh-allowed-signers'), 'utf8')).toBe(
      `${lease.userEmail} ${lease.publicKey}\n`,
    )
    const entries = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, index) => [
      env[`GIT_CONFIG_KEY_${index}`],
      env[`GIT_CONFIG_VALUE_${index}`],
    ])
    expect(entries).toEqual([
      ['gpg.format', 'ssh'],
      ['user.signingkey', keyPath],
      ['commit.gpgsign', 'true'],
      ['tag.gpgsign', 'true'],
      ['user.name', lease.userName],
      ['user.email', lease.userEmail],
      ['gpg.ssh.allowedSignersFile', join(atlasHome, 'ssh-allowed-signers')],
    ])
  })

  it('appends after git config entries already present in the env', async () => {
    const env: Record<string, string | undefined> = { GIT_CONFIG_COUNT: '3' }

    await start({ env, leaseStatus: 200 })

    expect(env.GIT_CONFIG_COUNT).toBe('10')
    expect(env.GIT_CONFIG_KEY_3).toBe('gpg.format')
  })

  it('writes nothing and leaves the env alone when the lease is a 404', async () => {
    const env: Record<string, string | undefined> = {}

    const atlasHome = await start({ env, leaseStatus: 404 })

    expect(existsSync(join(atlasHome, 'ssh-signing-key'))).toBe(false)
    expect(existsSync(join(atlasHome, 'ssh-allowed-signers'))).toBe(false)
    expect(env.GIT_CONFIG_COUNT).toBeUndefined()
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined()
  })
})
