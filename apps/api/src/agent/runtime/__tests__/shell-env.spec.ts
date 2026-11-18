import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { CollectingLog } from '../../__tests__/e2e-support'
import { ShellEnvCell, shellEnvOf, type GitIdentity, type SigningConfig } from '../shell-env'

const HOST_SECRETS = {
  DATABASE_URL: 'postgres://prod-host-secret',
  DATABASE_DIRECT_URL: 'postgres://prod-direct-secret',
  REDIS_URL: 'redis://prod-host-secret',
  DAEMON_SECRET: 'daemon-host-secret',
  SECRETS_ENCRYPTION_KEY: 'encryption-host-secret',
  BLOB_READ_WRITE_TOKEN: 'blob-host-secret',
}

const identity: GitIdentity = { name: 'octocat', email: '583231+octocat@users.noreply.github.com' }

const signing: SigningConfig = {
  keyPath: '/atlas/workspaces/.atlas-agent/signing-key',
  allowedSignersPath: '/atlas/workspaces/.atlas-agent/allowed-signers',
  userName: 'Dennis Signer',
  userEmail: 'dennis@example.com',
}

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
    expect(
      shellEnvOf({ githubToken: null, identity: null, signing: null, launchDirectory: '/w' }),
    ).toEqual({})
    expect(
      shellEnvOf({ githubToken: null, identity, signing: null, launchDirectory: '/w' }),
    ).toEqual({})
  })

  it('carries the token, the credential helper and the identity when a token exists', () => {
    const env = shellEnvOf({
      githubToken: 'gho_abc',
      identity,
      signing: null,
      launchDirectory: '/atlas/w/',
    })
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
    const env = shellEnvOf({
      githubToken: 'gho_abc',
      identity: null,
      signing: null,
      launchDirectory: '/w',
    })
    const keys = gitConfigOf(env).map(([key]) => key)
    expect(keys).not.toContain('user.name')
    expect(keys).not.toContain('user.email')
  })

  it('never carries a host secret name or value, nor PATH', () => {
    const env = shellEnvOf({
      githubToken: 'gho_abc',
      identity,
      signing: null,
      launchDirectory: '/w',
    })
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

describe('shellEnvOf acts as the user', () => {
  const cases = [
    {
      name: 'github identity',
      identity,
      signing: null,
      expected: [identity.name, identity.email] as const,
    },
    {
      name: 'signing identity',
      identity: null,
      signing,
      expected: [signing.userName, signing.userEmail] as const,
    },
    {
      name: 'signing over github identity',
      identity,
      signing,
      expected: [signing.userName, signing.userEmail] as const,
    },
  ]

  it.each(cases)('$name: the user is the only identity, with no trailer or Atlas entry', (c) => {
    const env = shellEnvOf({
      githubToken: 'gho_abc',
      identity: c.identity,
      signing: c.signing,
      launchDirectory: '/w',
    })
    const config = gitConfigOf(env)
    expect(config.filter(([key]) => key === 'user.name')).toEqual([['user.name', c.expected[0]]])
    expect(config.filter(([key]) => key === 'user.email')).toEqual([['user.email', c.expected[1]]])
    const keys = config.map(([key]) => key)
    for (const key of ['commit.template', 'core.hooksPath', 'author.name', 'committer.name']) {
      expect(keys).not.toContain(key)
    }
    expect(keys.filter((key) => key.startsWith('trailer.'))).toEqual([])
    const identityValues = config
      .filter(([key]) => key === 'user.name' || key === 'user.email')
      .map(([, value]) => value)
    expect(identityValues.join(' ')).not.toMatch(/atlas/i)
    expect(JSON.stringify(env)).not.toMatch(/co-authored-by/i)
  })
})

describe('shellEnvOf with a signing key', () => {
  const signingKeys = [
    'gpg.format',
    'user.signingkey',
    'commit.gpgsign',
    'tag.gpgsign',
    'gpg.ssh.allowedSignersFile',
  ]

  it('signs and uses the key identity next to the token entries', () => {
    const env = shellEnvOf({ githubToken: 'gho_abc', identity, signing, launchDirectory: '/w' })
    const config = gitConfigOf(env)
    expect(env.GH_TOKEN).toBe('gho_abc')
    expect(config).toContainEqual(['gpg.format', 'ssh'])
    expect(config).toContainEqual(['user.signingkey', signing.keyPath])
    expect(config).toContainEqual(['commit.gpgsign', 'true'])
    expect(config).toContainEqual(['tag.gpgsign', 'true'])
    expect(config).toContainEqual(['gpg.ssh.allowedSignersFile', signing.allowedSignersPath])
    expect(config).toContainEqual(['user.name', 'Dennis Signer'])
    expect(config).toContainEqual(['user.email', 'dennis@example.com'])
    expect(config.filter(([key]) => key === 'user.email')).toHaveLength(1)
    expect(config.map(([key]) => key)).toContain('credential.https://github.com.helper')
    expect(Number(env.GIT_CONFIG_COUNT)).toBe(config.length)
  })

  it('still emits safe.directory, identity and signing without a token', () => {
    const env = shellEnvOf({ githubToken: null, identity: null, signing, launchDirectory: '/w/' })
    const config = gitConfigOf(env)
    expect(env.GH_TOKEN).toBeUndefined()
    expect(config).toContainEqual(['safe.directory', '/w'])
    expect(config).toContainEqual(['safe.directory', '/w/*'])
    expect(config).toContainEqual(['user.email', 'dennis@example.com'])
    expect(config.map(([key]) => key)).toEqual(expect.arrayContaining(signingKeys))
    const keys = config.map(([key]) => key)
    expect(keys).not.toContain('credential.helper')
    expect(keys).not.toContain('credential.https://github.com.helper')
    expect(keys).not.toContain('url.https://github.com/.insteadOf')
  })

  it('treats an empty token like no token', () => {
    const env = shellEnvOf({ githubToken: '', identity: null, signing, launchDirectory: '/w' })
    expect(env.GH_TOKEN).toBeUndefined()
    expect(gitConfigOf(env).map(([key]) => key)).toContain('commit.gpgsign')
  })

  it('does not sign when there is no signing key', () => {
    const env = shellEnvOf({
      githubToken: 'gho_abc',
      identity,
      signing: null,
      launchDirectory: '/w',
    })
    const keys = gitConfigOf(env).map(([key]) => key)
    for (const key of signingKeys) expect(keys).not.toContain(key)
  })
})

const gitConfigKeysOf = (env: Readonly<Record<string, string>>): string[] =>
  Object.keys(env).filter((name) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name))

describe('ShellEnvCell', () => {
  const signal = new AbortController().signal

  it('starts empty and holds the env of the latest refresh', async () => {
    const cell = new ShellEnvCell({ identityOf: async () => identity })
    expect(cell.current()).toEqual({})
    await cell.refresh({ token: 'gho_one', signing: null, launchDirectory: '/w', signal })
    expect(cell.current().GH_TOKEN).toBe('gho_one')
    await cell.refresh({ token: 'gho_two', signing: null, launchDirectory: '/w', signal })
    expect(cell.current().GH_TOKEN).toBe('gho_two')
    await cell.refresh({ token: null, signing: null, launchDirectory: '/w', signal })
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
    await cell.refresh({ token: null, signing: null, launchDirectory: '/w', signal })
    await cell.refresh({ token: 'gho_one', signing: null, launchDirectory: '/w', signal })
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
    await cell.refresh({ token: 'gho_secret', signing: null, launchDirectory: '/w', signal })
    expect(cell.current().GH_TOKEN).toBe('gho_secret')
    expect(gitConfigOf(cell.current()).map(([key]) => key)).not.toContain('user.email')
    expect(log.dump('shell-env')).toContain('502')
    expect(log.dump('shell-env')).not.toContain('gho_secret')
  })

  it('prefers the signing identity over the github lookup and skips the lookup', async () => {
    const asked: string[] = []
    const cell = new ShellEnvCell({
      identityOf: async ({ token }) => {
        asked.push(token)
        return identity
      },
    })
    await cell.refresh({ token: 'gho_one', signing, launchDirectory: '/w', signal })
    expect(asked).toEqual([])
    const config = gitConfigOf(cell.current())
    expect(config).toContainEqual(['user.email', 'dennis@example.com'])
    expect(config).not.toContainEqual(['user.email', identity.email])
  })

  it('signs without a token', async () => {
    const cell = new ShellEnvCell({ identityOf: async () => identity })
    await cell.refresh({ token: null, signing, launchDirectory: '/w', signal })
    expect(cell.current().GH_TOKEN).toBeUndefined()
    expect(gitConfigOf(cell.current())).toContainEqual(['user.signingkey', signing.keyPath])
  })
})
