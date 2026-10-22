import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  existsSync,
  writeFileSync,
  chmodSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import type { SshSigningKeyLease } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLogLine } from '../serve-log'
import { applySigningKey, applySigningKeyEnv, fetchSigningKeyLease } from '../signing-key-env'

const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----'

const lease: SshSigningKeyLease = {
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLIC',
  privateKey: `${PEM}\n`,
  userName: 'octocat',
  userEmail: '583231+octocat@users.noreply.github.com',
}

const homes: string[] = []

const tempHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-signing-key-spec-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const preExistingGitEnv = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { GIT_CONFIG_COUNT: '7' }
  for (let index = 0; index < 7; index += 1) {
    env[`GIT_CONFIG_KEY_${index}`] = `pre.key${index}`
    env[`GIT_CONFIG_VALUE_${index}`] = `pre-value-${index}`
  }
  return env
}

const asFetch = (
  call: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): typeof fetch => Object.assign(call, { preconnect: () => undefined })

const requestOf = (args: {
  input: Parameters<typeof fetch>[0]
  init?: Parameters<typeof fetch>[1]
}): Request =>
  args.input instanceof Request
    ? new Request(args.input, args.init)
    : new Request(String(args.input), args.init)

const answering = (respond: (request: Request) => Response | Promise<Response>): typeof fetch =>
  asFetch(async (input, init) => respond(requestOf({ input, init })))

const fetchWith = (fetchFn: typeof fetch) =>
  fetchSigningKeyLease({
    controlPlaneUrl: 'https://api.example.com',
    token: 'pod-token',
    clientVersion: '1.2.3',
    fetchFn,
  })

describe('applySigningKeyEnv', () => {
  it('writes the private key at mode 600 with identical content', async () => {
    const atlasHome = tempHome()

    await applySigningKeyEnv({ env: {}, atlasHome, lease })

    const keyPath = join(atlasHome, 'ssh-signing-key')
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
    expect(readFileSync(keyPath, 'utf8')).toBe(lease.privateKey)
  })

  it('terminates a PEM that lacks a trailing newline', async () => {
    const atlasHome = tempHome()

    await applySigningKeyEnv({ env: {}, atlasHome, lease: { ...lease, privateKey: PEM } })

    expect(readFileSync(join(atlasHome, 'ssh-signing-key'), 'utf8')).toBe(`${PEM}\n`)
  })

  it('tightens a key file that already existed with a wider mode', async () => {
    const atlasHome = tempHome()
    const keyPath = join(atlasHome, 'ssh-signing-key')
    writeFileSync(keyPath, 'stale', { mode: 0o644 })
    chmodSync(keyPath, 0o644)

    await applySigningKeyEnv({ env: {}, atlasHome, lease })

    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
    expect(readFileSync(keyPath, 'utf8')).toBe(lease.privateKey)
  })

  it('writes the allowed signers file as `<email> <public key>`', async () => {
    const atlasHome = tempHome()

    await applySigningKeyEnv({ env: {}, atlasHome, lease })

    const allowedPath = join(atlasHome, 'ssh-allowed-signers')
    expect(readFileSync(allowedPath, 'utf8')).toBe(`${lease.userEmail} ${lease.publicKey}\n`)
    expect(statSync(allowedPath).mode & 0o777).toBe(0o644)
  })

  it('appends seven git config entries after the existing ones', async () => {
    const atlasHome = tempHome()
    const env = preExistingGitEnv()

    await applySigningKeyEnv({ env, atlasHome, lease })

    expect(env.GIT_CONFIG_COUNT).toBe('14')
    expect(env.GIT_CONFIG_KEY_6).toBe('pre.key6')
    const appended = Array.from({ length: 7 }, (_, index) => [
      env[`GIT_CONFIG_KEY_${7 + index}`],
      env[`GIT_CONFIG_VALUE_${7 + index}`],
    ])
    expect(appended).toEqual([
      ['gpg.format', 'ssh'],
      ['user.signingkey', join(atlasHome, 'ssh-signing-key')],
      ['commit.gpgsign', 'true'],
      ['tag.gpgsign', 'true'],
      ['user.name', lease.userName],
      ['user.email', lease.userEmail],
      ['gpg.ssh.allowedSignersFile', join(atlasHome, 'ssh-allowed-signers')],
    ])
  })

  it('starts at index 0 when no git config count exists', async () => {
    const env: Record<string, string | undefined> = {}

    await applySigningKeyEnv({ env, atlasHome: tempHome(), lease })

    expect(env.GIT_CONFIG_COUNT).toBe('7')
    expect(env.GIT_CONFIG_KEY_0).toBe('gpg.format')
    expect(env.GIT_CONFIG_KEY_6).toBe('gpg.ssh.allowedSignersFile')
  })
})

describe('fetchSigningKeyLease', () => {
  it('returns the lease and sends the bearer token to the lease route', async () => {
    const seen: Request[] = []
    const fetchFn = answering((request) => {
      seen.push(request)
      return Response.json(lease)
    })

    const fetched = await fetchWith(fetchFn)

    expect(fetched).toEqual(lease)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('GET')
    expect(new URL(seen[0]?.url ?? '').pathname).toBe('/v1/ssh-signing-key')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer pod-token')
    expect(seen[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
  })

  it('returns undefined for a 404', async () => {
    expect(await fetchWith(answering(() => new Response(null, { status: 404 })))).toBeUndefined()
  })

  it('returns undefined for a 500', async () => {
    const fetchFn = answering(() => Response.json({ message: 'boom' }, { status: 500 }))

    expect(await fetchWith(fetchFn)).toBeUndefined()
  })

  it('returns undefined when the fetch throws', async () => {
    const fetchFn = asFetch(async () => {
      throw new Error('offline')
    })

    expect(await fetchWith(fetchFn)).toBeUndefined()
  })

  it('returns undefined for a malformed body', async () => {
    expect(await fetchWith(answering(() => Response.json({ publicKey: 'only' })))).toBeUndefined()
  })
})

describe('applySigningKey', () => {
  const run = async (args: { atlasHome: string; fetchFn: typeof fetch }) => {
    const env = preExistingGitEnv()
    const lines: ServeLogLine[] = []
    await applySigningKey({
      env,
      atlasHome: args.atlasHome,
      log: (line) => lines.push(line),
      controlPlaneUrl: 'https://api.example.com',
      token: 'pod-token',
      clientVersion: 'dev',
      fetchFn: args.fetchFn,
    })
    return { env, lines }
  }

  it('applies the lease and logs readiness without the key', async () => {
    const atlasHome = tempHome()

    const { env, lines } = await run({ atlasHome, fetchFn: answering(() => Response.json(lease)) })

    expect(env.GIT_CONFIG_COUNT).toBe('14')
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.SigningKeyReady])
    expect(JSON.stringify(lines)).not.toContain('AAAA')
  })

  it('leaves the home and env untouched when there is no lease', async () => {
    const atlasHome = tempHome()

    const { env, lines } = await run({
      atlasHome,
      fetchFn: answering(() => new Response(null, { status: 404 })),
    })

    expect(existsSync(join(atlasHome, 'ssh-signing-key'))).toBe(false)
    expect(existsSync(join(atlasHome, 'ssh-allowed-signers'))).toBe(false)
    expect(env).toEqual(preExistingGitEnv())
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.SigningKeyAbsent])
  })

  it('skips the env entries and logs when the key file cannot be written', async () => {
    const blocker = join(tempHome(), 'not-a-directory')
    writeFileSync(blocker, 'file')

    const { env, lines } = await run({
      atlasHome: join(blocker, 'home'),
      fetchFn: answering(() => Response.json(lease)),
    })

    expect(env).toEqual(preExistingGitEnv())
    expect(lines.map((line) => line.event)).toEqual([EServeEvent.SigningKeyWriteFailed])
    expect(JSON.stringify(lines)).not.toContain('AAAA')
  })
})
