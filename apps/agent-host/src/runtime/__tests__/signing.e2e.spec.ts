import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import { systemTimers } from '@dltech/atlas-host'

import { sourceFor, unusedTokens } from '../../__tests__/e2e-support'
import { LocalSandboxProvider } from '../../testing/local-sandbox-provider'
import type { SigningKey } from '../../tokens/signing-key-reader'
import { createSessionRuntimeFactory } from '../session-runtime-factory'

const scratch: string[] = []

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

const keypairOf = async (): Promise<SigningKey> => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-signing-keygen-'))
  scratch.push(dir)
  const keygen = Bun.spawn(['ssh-keygen', '-t', 'ed25519', '-N', '', '-q', '-f', join(dir, 'k')])
  expect(await keygen.exited).toBe(0)
  return {
    publicKey: (await Bun.file(join(dir, 'k.pub')).text()).trim(),
    privateKey: await Bun.file(join(dir, 'k')).text(),
    userName: 'Signing Dennis',
    userEmail: 'signer@example.com',
  }
}

const COMMIT_SCRIPT = [
  'set -e',
  'cd "$(mktemp -d)"',
  'git init -q',
  'git commit -q --allow-empty -m signed',
  'git verify-commit HEAD 2>&1',
  'echo "author=$(git log -1 --format=%an\\ %ae)"',
  'echo "message=$(git log -1 --format=%B)"',
  'git log --show-signature -1 | grep -E "Good|signature"',
].join('\n')

const commitInShell = async (args: {
  signingKey: SigningKey | null
  token: string | null
  prepareTwice?: boolean
}): Promise<{ output: string; keyMode: number | null }> => {
  const sandbox = new LocalSandboxProvider({ daemonSecret: 'signing-secret' })
  const root = mkdtempSync(join(tmpdir(), 'atlas-signing-'))
  scratch.push(root)
  const launchDirectory = join(root, 'workspace')
  try {
    const runtime = await createSessionRuntimeFactory({
      config: sourceFor(),
      tokens: unusedTokens(),
      github: { read: async () => args.token },
      signingKey: { read: async () => args.signingKey },
      githubFetch: (async () =>
        new Response(JSON.stringify({ id: 1, login: 'octocat' }))) as unknown as typeof fetch,
      sandbox,
      daemonSecret: 'signing-secret',
      timers: { now: () => Date.now(), ...systemTimers },
      modelFor: () => new ScriptedModel([]),
      launchDirectory,
      setupDeadlineMs: 60_000,
    })({
      sessionId: 'signing-session',
      threadId: toThreadId('signing-thread'),
      epoch: 1,
      signal: new AbortController().signal,
    })
    expect(await runtime.prepare()).toEqual({ ok: true })
    const outcome: ToolOutcome | undefined = await runtime.tools.find('bash')?.invoke({
      input: { description: 'Commit and verify', command: COMMIT_SCRIPT },
      signal: new AbortController().signal,
      idempotencyKey: 'signing-1',
      projectDirectory: launchDirectory,
      threadId: toThreadId('signing-thread'),
    })
    await runtime.stop()
    if (outcome === undefined || !outcome.ok) throw new Error('bash did not run')
    const keyPath = join(root, '.atlas-agent', 'signing-key')
    return {
      output: outcome.modelText ?? '',
      keyMode: args.signingKey === null ? null : statSync(keyPath).mode & 0o777,
    }
  } finally {
    await sandbox.stopAll()
  }
}

describe('a commit in a sandbox shell', () => {
  it('is signed and verifies with the allowed signers file, with a token', async () => {
    const { output, keyMode } = await commitInShell({
      signingKey: await keypairOf(),
      token: 'gho_e2e',
    })
    expect(output).toContain('Good "git" signature for signer@example.com')
    expect(output).toContain('author=Signing Dennis signer@example.com')
    expect(output).toContain('message=signed')
    expect(output).not.toMatch(/co-authored-by|atlas/i)
    expect(keyMode).toBe(0o600)
  }, 60_000)

  it('is signed without a github token', async () => {
    const { output } = await commitInShell({ signingKey: await keypairOf(), token: null })
    expect(output).toContain('Good "git" signature for signer@example.com')
  }, 60_000)
})
