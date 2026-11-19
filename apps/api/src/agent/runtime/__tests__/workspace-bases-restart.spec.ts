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

import { sandboxNameOf } from '../../sandbox/sandbox-provider'
import { LocalSandboxProvider } from '../../testing/local-sandbox-provider'
import { ensureWorkspace, WORKSPACE_STATE_DIR } from '../workspace-setup'
import { additionalSentinelOf, PRIMARY_SENTINEL, SESSION_BASES_FILE } from '../workspace-state'

const SECRET = 'workspace-bases-secret'
const sandbox = new LocalSandboxProvider({ daemonSecret: SECRET })

afterAll(async () => {
  await sandbox.stopAll()
})

const git = (args: readonly string[], cwd: string): void => {
  const result = Bun.spawnSync(['git', ...args], { cwd })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`)
  }
}

const openPorts = async (args: { sessionId: string }) => {
  const endpoint = await sandbox.wake({
    sandboxSessionId: args.sessionId,
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

const workspaceOf = {
  remoteUrl: 'https://github.com/acme/app.git',
  baseBranch: null,
  additionalRepos: [{ repo: 'acme/lib' }],
  setupScript: '',
}

describe('the captured session bases on a materialized workspace', () => {
  it('replays the base of every repo, and never the branch the agent moved to', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-bases-'))
    const launchDirectory = join(root, 'workspace')
    const libDirectory = join(root, 'lib')
    const stateDir = join(root, WORKSPACE_STATE_DIR)
    mkdirSync(stateDir, { recursive: true })
    for (const dir of [launchDirectory, libDirectory]) {
      mkdirSync(dir, { recursive: true })
      git(['init', '-b', 'main'], dir)
    }
    writeFileSync(join(stateDir, PRIMARY_SENTINEL), JSON.stringify({ at: 'earlier' }))
    writeFileSync(
      additionalSentinelOf({ stateDir, repo: 'acme/lib' }),
      JSON.stringify({ at: 'earlier' }),
    )
    const ports = await openPorts({ sessionId: 'workspace-bases-restart' })
    const bases = [
      { repoPath: launchDirectory, base: 'main' },
      { repoPath: libDirectory, base: 'main' },
    ]
    const first = await ensureWorkspace({
      ...ports,
      workspace: workspaceOf,
      githubToken: null,
      launchDirectory,
      sandboxName: sandboxNameOf('workspace-bases-restart'),
    })

    expect(first).toEqual({ ok: true, bases })
    expect(await ports.files.readFile({ path: join(stateDir, SESSION_BASES_FILE) })).toContain(
      'main',
    )
    git(['checkout', '-b', 'feat-x'], launchDirectory)
    git(['checkout', '-b', 'feat-lib'], libDirectory)

    const second = await ensureWorkspace({
      ...ports,
      workspace: workspaceOf,
      githubToken: null,
      launchDirectory,
      sandboxName: sandboxNameOf('workspace-bases-restart'),
    })

    expect(second).toEqual({ ok: true, bases })
    ports.calls.close()
  }, 60_000)
})
