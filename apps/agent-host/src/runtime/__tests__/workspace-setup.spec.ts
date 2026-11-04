import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DaemonFileSystemPort,
  DaemonProcessPort,
  RemoteCalls,
  systemTimers,
  webSocketConnector,
} from '@dltech/atlas-host'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import { CollectingLog } from '../../__tests__/e2e-support'
import { sandboxNameOf } from '../../sandbox/sandbox-provider'
import { LocalSandboxProvider } from '../../testing/local-sandbox-provider'
import { ensureWorkspace, WORKSPACE_SENTINEL } from '../workspace-setup'

const SECRET = 'workspace-setup-secret'
const TOKEN = 'ghp_secret-token-xyz'

const sandbox = new LocalSandboxProvider({ daemonSecret: SECRET })

afterAll(async () => {
  await sandbox.stopAll()
})

const git = (args: string[], cwd: string): void => {
  const result = Bun.spawnSync(['git', ...args], { cwd })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`)
  }
}

const makeRemote = (dir: string): string => {
  const src = join(dir, 'src')
  mkdirSync(src, { recursive: true })
  git(['init', '-b', 'main'], src)
  git(['config', 'user.email', 'test@example.com'], src)
  git(['config', 'user.name', 'Test'], src)
  writeFileSync(join(src, 'hello.txt'), 'hello from the repo\n')
  git(['add', '.'], src)
  git(['commit', '-m', 'init'], src)
  const bare = join(dir, 'repo.git')
  git(['clone', '--bare', src, bare], dir)
  return `file://${bare}`
}

const openPorts = async (args: { sessionId: string }) => {
  const endpoint = await sandbox.wake({
    sessionId: args.sessionId,
    credentials: { token: '', teamId: '', projectId: '' },
    signal: new AbortController().signal,
  })
  const calls = new RemoteCalls({
    sessionId: args.sessionId,
    token: daemonToken({ secret: SECRET, sandboxName: sandboxNameOf(args.sessionId) }),
    connector: async () => webSocketConnector({ url: endpoint.url }),
    timers: systemTimers,
    onFenced: () => {},
  })
  calls.open({ epoch: 1 })
  await calls.ready()
  return {
    calls,
    processes: new DaemonProcessPort({ calls }),
    files: new DaemonFileSystemPort({ calls }),
  }
}

describe('ensureWorkspace', () => {
  it('clones once per disk and runs the setup script once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-setup-'))
    const remoteUrl = makeRemote(root)
    const launchDirectory = join(root, 'workspace')
    mkdirSync(launchDirectory)
    const { calls, processes, files } = await openPorts({ sessionId: 'setup-session-1' })
    const workspace = {
      remoteUrl,
      baseBranch: null,
      additionalRepos: [],
      setupScript: 'echo ran >> setup-ran.txt',
    }

    await ensureWorkspace({ processes, files, workspace, githubToken: null, launchDirectory })

    expect(await files.readFile({ path: join(launchDirectory, 'hello.txt') })).toBe(
      'hello from the repo\n',
    )
    expect(await files.readFile({ path: join(launchDirectory, WORKSPACE_SENTINEL) })).toContain(
      'at',
    )
    expect(await files.readFile({ path: join(launchDirectory, 'setup-ran.txt') })).toBe('ran\n')

    await ensureWorkspace({ processes, files, workspace, githubToken: null, launchDirectory })

    expect(await files.readFile({ path: join(launchDirectory, 'setup-ran.txt') })).toBe('ran\n')
    calls.close()
  }, 60_000)

  it('never lets the github token reach the log', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-scrub-'))
    const launchDirectory = join(root, 'workspace')
    mkdirSync(launchDirectory)
    const log = new CollectingLog()
    const { calls, processes, files } = await openPorts({ sessionId: 'setup-session-2' })

    await ensureWorkspace({
      processes,
      files,
      workspace: {
        remoteUrl: 'https://127.0.0.1:9/nope/nope.git',
        baseBranch: null,
        additionalRepos: [],
        setupScript: '',
      },
      githubToken: TOKEN,
      launchDirectory,
      log,
    })

    expect(log.entries.length).toBeGreaterThan(0)
    for (const entry of log.entries) {
      expect(JSON.stringify(entry)).not.toContain(TOKEN)
    }
    calls.close()
  }, 60_000)
})
