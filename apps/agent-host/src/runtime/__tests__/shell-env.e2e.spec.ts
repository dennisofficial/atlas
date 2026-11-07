import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { systemTimers } from '@dltech/atlas-host'

import { sourceFor, unusedTokens } from '../../__tests__/e2e-support'
import { LocalSandboxProvider } from '../../testing/local-sandbox-provider'
import { createSessionRuntimeFactory } from '../session-runtime-factory'

const HOST_SECRETS = ['DATABASE_URL', 'REDIS_URL', 'DAEMON_SECRET', 'SECRETS_ENCRYPTION_KEY']

const identityFetch = (async () =>
  new Response(JSON.stringify({ id: 583231, login: 'octocat' }))) as unknown as typeof fetch

const shellOutputOf = async (args: { token: string | null }): Promise<string> => {
  const sandbox = new LocalSandboxProvider({ daemonSecret: 'shell-env-secret' })
  const launchDirectory = mkdtempSync(join(tmpdir(), 'atlas-shell-env-'))
  try {
    const runtime = await createSessionRuntimeFactory({
      config: sourceFor(),
      tokens: unusedTokens(),
      github: { read: async () => args.token },
      githubFetch: identityFetch,
      sandbox,
      daemonSecret: 'shell-env-secret',
      timers: { now: () => Date.now(), ...systemTimers },
      modelFor: () => new ScriptedModel([]),
      launchDirectory,
      setupDeadlineMs: 60_000,
    })({
      sessionId: 'shell-env-session',
      threadId: toThreadId('shell-env-thread'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    expect(await runtime.prepare()).toEqual({ ok: true })
    for (const name of HOST_SECRETS) process.env[name] = `host-secret-${name}`
    const outcome: ToolOutcome | undefined = await runtime.tools.find('bash')?.invoke({
      input: {
        description: 'Print the shell env',
        command:
          'echo "email=$(git config user.email)"; echo "name=$(git config user.name)"; ' +
          'echo "token=${GH_TOKEN-unset}"; env | grep -E "^(DATABASE_URL|REDIS_URL|DAEMON_SECRET|SECRETS_ENCRYPTION_KEY)=" || echo "no host secrets"',
      },
      signal: new AbortController().signal,
      idempotencyKey: 'shell-env-1',
      projectDirectory: launchDirectory,
      threadId: toThreadId('shell-env-thread'),
    })
    await runtime.stop()
    if (outcome === undefined || !outcome.ok) throw new Error('bash did not run')
    return outcome.modelText ?? ''
  } finally {
    await sandbox.stopAll()
  }
}

afterEach(() => {
  for (const name of HOST_SECRETS) delete process.env[name]
})

describe('a shell in the sandbox', () => {
  it('has the token and git identity of the user and none of the host secrets', async () => {
    const output = await shellOutputOf({ token: 'gho_e2e' })
    expect(output).toContain('email=583231+octocat@users.noreply.github.com')
    expect(output).toContain('name=octocat')
    expect(output).toContain('token=gho_e2e')
    expect(output).toContain('no host secrets')
    expect(output).not.toContain('host-secret-')
  }, 60_000)

  it('has no token and no identity without a github connection', async () => {
    const output = await shellOutputOf({ token: null })
    expect(output).toContain('email=\n')
    expect(output).toContain('token=unset')
    expect(output).toContain('no host secrets')
  }, 60_000)
})
