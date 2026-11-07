import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { CollectingLog } from '../../__tests__/e2e-support'
import { ShellEnvCell, shellEnvOf, type GitIdentity } from '../shell-env'

const HOST_SECRETS = {
  DATABASE_URL: 'postgres://prod-host-secret',
  DATABASE_DIRECT_URL: 'postgres://prod-direct-secret',
  REDIS_URL: 'redis://prod-host-secret',
  DAEMON_SECRET: 'daemon-host-secret',
  SECRETS_ENCRYPTION_KEY: 'encryption-host-secret',
  BLOB_READ_WRITE_TOKEN: 'blob-host-secret',
}

const identity: GitIdentity = { name: 'octocat', email: '583231+octocat@users.noreply.github.com' }

const gitConfigOf = (env: Readonly<Record<string, string>>): [string, string][] => {
  const count = Number(env.GIT_CONFIG_COUNT ?? '0')
  return Array.from({ length: count }, (_, index): [string, string] => [
    env[`GIT_CONFIG_KEY_${index}`] ?? '',
    env[`GIT_CONFIG_VALUE_${index}`] ?? '',
  ])
}

const previous = { ...process.env }

beforeEach(() => {
  Object.assign(process.env, HOST_SECRETS)
})

afterEach(() => {
  for (const name of Object.keys(HOST_SECRETS)) {
    if (previous[name] === undefined) delete process.env[name]
    else process.env[name] = previous[name]
  }
})

describe('shellEnvOf', () => {
  it('is empty without a github token, whatever the host holds', () => {
    expect(shellEnvOf({ githubToken: null, identity: null, launchDirectory: '/w' })).toEqual({})
    expect(shellEnvOf({ githubToken: null, identity, launchDirectory: '/w' })).toEqual({})
  })

  it('carries the token, the credential helper and the identity when a token exists', () => {
    const env = shellEnvOf({ githubToken: 'gho_abc', identity, launchDirectory: '/atlas/w/' })
    expect(env.GH_TOKEN).toBe('gho_abc')
    const config = gitConfigOf(env)
    expect(config).toContainEqual(['safe.directory', '/atlas/w'])
    expect(config).toContainEqual(['safe.directory', '/atlas/w/*'])
    expect(config).toContainEqual(['url.https://github.com/.insteadOf', 'git@github.com:'])
    expect(config).toContainEqual(['url.https://github.com/.insteadOf', 'ssh://git@github.com/'])
    expect(config).toContainEqual(['user.name', 'octocat'])
    expect(config).toContainEqual(['user.email', '583231+octocat@users.noreply.github.com'])
    const helper = config.find(([key]) => key === 'credential.https://github.com.helper')
    expect(helper?.[1]).toContain('$GH_TOKEN')
    expect(helper?.[1]).not.toContain('gho_abc')
  })

  it('leaves the identity out when it is unknown', () => {
    const env = shellEnvOf({ githubToken: 'gho_abc', identity: null, launchDirectory: '/w' })
    const keys = gitConfigOf(env).map(([key]) => key)
    expect(keys).not.toContain('user.name')
    expect(keys).not.toContain('user.email')
  })

  it('never carries a host secret name or value, nor PATH', () => {
    const env = shellEnvOf({ githubToken: 'gho_abc', identity, launchDirectory: '/w' })
    const serialized = JSON.stringify(env)
    for (const [name, value] of Object.entries(HOST_SECRETS)) {
      expect(env[name]).toBeUndefined()
      expect(serialized).not.toContain(value)
    }
    expect(Object.keys(env).sort()).toEqual(
      ['GH_TOKEN', 'GIT_CONFIG_COUNT', ...gitConfigKeysOf(env)].sort(),
    )
  })
})

const gitConfigKeysOf = (env: Readonly<Record<string, string>>): string[] =>
  Object.keys(env).filter((name) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name))

describe('ShellEnvCell', () => {
  const signal = new AbortController().signal

  it('starts empty and holds the env of the latest refresh', async () => {
    const cell = new ShellEnvCell({ identityOf: async () => identity })
    expect(cell.current()).toEqual({})
    await cell.refresh({ token: 'gho_one', launchDirectory: '/w', signal })
    expect(cell.current().GH_TOKEN).toBe('gho_one')
    await cell.refresh({ token: 'gho_two', launchDirectory: '/w', signal })
    expect(cell.current().GH_TOKEN).toBe('gho_two')
    await cell.refresh({ token: null, launchDirectory: '/w', signal })
    expect(cell.current()).toEqual({})
  })

  it('asks for the identity only when there is a token', async () => {
    const asked: string[] = []
    const cell = new ShellEnvCell({
      identityOf: async ({ token }) => {
        asked.push(token)
        return identity
      },
    })
    await cell.refresh({ token: null, launchDirectory: '/w', signal })
    await cell.refresh({ token: 'gho_one', launchDirectory: '/w', signal })
    expect(asked).toEqual(['gho_one'])
  })

  it('keeps the token and logs when the identity lookup fails, without the token in the log', async () => {
    const log = new CollectingLog()
    const cell = new ShellEnvCell({
      identityOf: async () => {
        throw new Error('GitHub answered 502 for the authenticated user')
      },
      log,
    })
    await cell.refresh({ token: 'gho_secret', launchDirectory: '/w', signal })
    expect(cell.current().GH_TOKEN).toBe('gho_secret')
    expect(gitConfigOf(cell.current()).map(([key]) => key)).not.toContain('user.email')
    expect(log.dump('shell-env')).toContain('502')
    expect(log.dump('shell-env')).not.toContain('gho_secret')
  })
})
