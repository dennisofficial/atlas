import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import type { SshSigningKeyLease } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLogLine } from '../serve-log'
import { applySigningKey, applySigningKeyEnv, ESigningKeyEnvResult } from '../signing-key-env'
import { trpcOk } from './trpc-fake'

const lease: SshSigningKeyLease = {
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPUBLIC',
  privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n',
  userName: 'octocat',
  userEmail: '583231+octocat@users.noreply.github.com',
}

const roots: string[] = []

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-signing-key-write-spec-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0, roots.length)) rmSync(root, { recursive: true, force: true })
})

const asFetch = (call: () => Promise<Response>): typeof fetch =>
  Object.assign(call, { preconnect: () => undefined })

const modeOf = (path: string): number => lstatSync(path).mode & 0o777

describe('applySigningKeyEnv file writes', () => {
  it('replaces an existing 0644 key file with a 0600 file holding the new key', async () => {
    const atlasHome = tempDir()
    const keyPath = join(atlasHome, 'ssh-signing-key')
    writeFileSync(keyPath, 'stale')
    chmodSync(keyPath, 0o644)

    await applySigningKeyEnv({ env: {}, atlasHome, lease })

    expect(modeOf(keyPath)).toBe(0o600)
    expect(readFileSync(keyPath, 'utf8')).toBe(lease.privateKey)
  })

  it('replaces a symlink at the key path without touching its target', async () => {
    const atlasHome = tempDir()
    const targetDir = tempDir()
    const target = join(targetDir, 'victim')
    writeFileSync(target, 'precious')
    chmodSync(target, 0o644)
    const keyPath = join(atlasHome, 'ssh-signing-key')
    symlinkSync(target, keyPath)

    await applySigningKeyEnv({ env: {}, atlasHome, lease })

    expect(readFileSync(target, 'utf8')).toBe('precious')
    expect(modeOf(target)).toBe(0o644)
    expect(lstatSync(keyPath).isSymbolicLink()).toBe(false)
    expect(lstatSync(keyPath).isFile()).toBe(true)
    expect(modeOf(keyPath)).toBe(0o600)
    expect(readFileSync(keyPath, 'utf8')).toBe(lease.privateKey)
  })

  it('replaces a symlink at the allowed signers path without touching its target', async () => {
    const atlasHome = tempDir()
    const targetDir = tempDir()
    const target = join(targetDir, 'victim')
    writeFileSync(target, 'precious')
    const allowedPath = join(atlasHome, 'ssh-allowed-signers')
    symlinkSync(target, allowedPath)

    await applySigningKeyEnv({ env: {}, atlasHome, lease })

    expect(readFileSync(target, 'utf8')).toBe('precious')
    expect(lstatSync(allowedPath).isFile()).toBe(true)
    expect(modeOf(allowedPath)).toBe(0o644)
    expect(readFileSync(allowedPath, 'utf8')).toBe(`${lease.userEmail} ${lease.publicKey}\n`)
  })

  it('leaves no temp files in the home after success', async () => {
    const atlasHome = tempDir()

    await applySigningKeyEnv({ env: {}, atlasHome, lease })

    expect(readdirSync(atlasHome).sort()).toEqual(['ssh-allowed-signers', 'ssh-signing-key'])
  })

  it('leaves no temp files in the home after a forced failure', async () => {
    const atlasHome = tempDir()
    mkdirSync(join(atlasHome, 'ssh-allowed-signers'))

    await expect(applySigningKeyEnv({ env: {}, atlasHome, lease })).rejects.toThrow()

    expect(readdirSync(atlasHome).sort()).toEqual(['ssh-allowed-signers', 'ssh-signing-key'])
  })
})

describe('applySigningKeyEnv git config count validation', () => {
  const invalidEnvs: Array<{ name: string; env: Record<string, string | undefined> }> = [
    { name: 'garbage', env: { GIT_CONFIG_COUNT: 'garbage' } },
    { name: 'negative', env: { GIT_CONFIG_COUNT: '-1' } },
    { name: 'fractional', env: { GIT_CONFIG_COUNT: '1.5' } },
    { name: 'empty', env: { GIT_CONFIG_COUNT: '' } },
    { name: 'unsafe integer', env: { GIT_CONFIG_COUNT: '99999999999999999999' } },
    {
      name: 'a missing index',
      env: {
        GIT_CONFIG_COUNT: '3',
        GIT_CONFIG_KEY_0: 'a.b',
        GIT_CONFIG_VALUE_0: 'x',
        GIT_CONFIG_VALUE_1: 'y',
        GIT_CONFIG_KEY_2: 'c.d',
        GIT_CONFIG_VALUE_2: 'z',
      },
    },
  ]

  for (const { name, env: invalidEnv } of invalidEnvs) {
    it(`appends nothing for ${name}`, async () => {
      const env = { ...invalidEnv }

      const result = await applySigningKeyEnv({ env, atlasHome: tempDir(), lease })

      expect(result).toBe(ESigningKeyEnvResult.EnvInvalid)
      expect(env).toEqual(invalidEnv)
    })

    it(`logs an invalid env event without readiness or the key for ${name}`, async () => {
      const lines: ServeLogLine[] = []
      const env = { ...invalidEnv }

      await applySigningKey({
        env,
        atlasHome: tempDir(),
        log: (line) => lines.push(line),
        controlPlaneUrl: 'https://api.example.com',
        token: 'pod-token',
        clientVersion: 'dev',
        fetchFn: asFetch(async () => trpcOk(lease)),
      })

      expect(lines.map((line) => line.event)).toEqual([EServeEvent.SigningKeyEnvInvalid])
      expect(JSON.stringify(lines)).not.toContain('AAAA')
      expect(env).toEqual(invalidEnv)
    })
  }

  it('accepts a count whose every index is defined', async () => {
    const env: Record<string, string | undefined> = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'a.b',
      GIT_CONFIG_VALUE_0: 'x',
    }

    const result = await applySigningKeyEnv({ env, atlasHome: tempDir(), lease })

    expect(result).toBe(ESigningKeyEnvResult.Applied)
    expect(env.GIT_CONFIG_COUNT).toBe('8')
  })
})
