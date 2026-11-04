import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
import {
  ensureWorkspace,
  MATERIALIZED_SENTINEL,
  SETUP_SENTINEL,
  WORKSPACE_STATE_DIR,
} from '../workspace-setup'

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

const setupFor = (args: {
  sessionId: string
  calls: RemoteCalls
  processes: DaemonProcessPort
  files: DaemonFileSystemPort
  workspace: {
    remoteUrl: string | null
    baseBranch: string | null
    additionalRepos: { repo: string; branch?: string }[]
    setupScript: string
  }
  githubToken?: string | null
  launchDirectory: string
  log?: CollectingLog
}) =>
  ensureWorkspace({
    calls: args.calls,
    processes: args.processes,
    files: args.files,
    workspace: args.workspace,
    githubToken: args.githubToken ?? null,
    launchDirectory: args.launchDirectory,
    sandboxName: sandboxNameOf(args.sessionId),
    ...(args.log === undefined ? {} : { log: args.log }),
  })

const waitFor = async (want: () => boolean): Promise<void> => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (want()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for a condition')
}

describe('ensureWorkspace', () => {
  it('clones once per disk and runs the setup script once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-setup-'))
    const remoteUrl = makeRemote(root)
    const launchDirectory = join(root, 'workspace')
    const { calls, processes, files } = await openPorts({ sessionId: 'setup-session-1' })
    const workspace = {
      remoteUrl,
      baseBranch: null,
      additionalRepos: [],
      setupScript: 'echo ran >> setup-ran.txt',
    }

    await setupFor({
      sessionId: 'setup-session-1',
      calls,
      processes,
      files,
      workspace,
      launchDirectory,
    })

    const stateDir = join(root, WORKSPACE_STATE_DIR)
    expect(await files.readFile({ path: join(launchDirectory, 'hello.txt') })).toBe(
      'hello from the repo\n',
    )
    expect(await files.readFile({ path: join(stateDir, MATERIALIZED_SENTINEL) })).toContain('at')
    expect(await files.readFile({ path: join(launchDirectory, 'setup-ran.txt') })).toBe('ran\n')

    await setupFor({
      sessionId: 'setup-session-1',
      calls,
      processes,
      files,
      workspace,
      launchDirectory,
    })

    expect(await files.readFile({ path: join(launchDirectory, 'setup-ran.txt') })).toBe('ran\n')
    calls.close()
  }, 60_000)

  it('never lets the github token reach the log or outlive the setup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-scrub-'))
    const launchDirectory = join(root, 'workspace')
    const log = new CollectingLog()
    const { calls, processes, files } = await openPorts({ sessionId: 'setup-session-2' })

    await setupFor({
      sessionId: 'setup-session-2',
      calls,
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
    expect(existsSync(join(root, WORKSPACE_STATE_DIR, 'github-token'))).toBe(false)
    calls.close()
  }, 60_000)

  it('removes a leftover staging dir and clones again', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-staging-'))
    const remoteUrl = makeRemote(root)
    const launchDirectory = join(root, 'workspace')
    const staging = join(root, '.atlas-workspace-staging')
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, 'junk.txt'), 'interrupted clone\n')
    const { calls, processes, files } = await openPorts({ sessionId: 'setup-session-3' })

    await setupFor({
      sessionId: 'setup-session-3',
      calls,
      processes,
      files,
      workspace: { remoteUrl, baseBranch: null, additionalRepos: [], setupScript: '' },
      launchDirectory,
    })

    expect(await files.readFile({ path: join(launchDirectory, 'hello.txt') })).toBe(
      'hello from the repo\n',
    )
    expect(existsSync(staging)).toBe(false)
    calls.close()
  }, 60_000)

  it('leaves a pre-populated unmaterialized workspace untouched', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-prepopulated-'))
    const remoteUrl = makeRemote(root)
    const launchDirectory = join(root, 'workspace')
    mkdirSync(launchDirectory)
    writeFileSync(join(launchDirectory, 'keep.txt'), 'user data\n')
    const log = new CollectingLog()
    const { calls, processes, files } = await openPorts({ sessionId: 'setup-session-4' })

    await setupFor({
      sessionId: 'setup-session-4',
      calls,
      processes,
      files,
      workspace: {
        remoteUrl,
        baseBranch: null,
        additionalRepos: [],
        setupScript: 'echo ran >> setup-ran.txt',
      },
      launchDirectory,
      log,
    })

    expect(readFileSync(join(launchDirectory, 'keep.txt'), 'utf8')).toBe('user data\n')
    expect(existsSync(join(launchDirectory, 'hello.txt'))).toBe(false)
    expect(existsSync(join(launchDirectory, 'setup-ran.txt'))).toBe(false)
    expect(existsSync(join(root, WORKSPACE_STATE_DIR, MATERIALIZED_SENTINEL))).toBe(false)
    expect(log.dump('prepopulated')).toContain('not empty')
    calls.close()
  }, 60_000)

  it('runs the setup script for a repo-less project and records it in disk state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-repoless-'))
    const launchDirectory = join(root, 'workspace')
    const { calls, processes, files } = await openPorts({ sessionId: 'setup-session-5' })

    await setupFor({
      sessionId: 'setup-session-5',
      calls,
      processes,
      files,
      workspace: {
        remoteUrl: null,
        baseBranch: null,
        additionalRepos: [],
        setupScript: 'echo provisioned >> out.txt',
      },
      launchDirectory,
    })

    expect(await files.readFile({ path: join(launchDirectory, 'out.txt') })).toBe('provisioned\n')
    const stateDir = join(root, WORKSPACE_STATE_DIR)
    expect(existsSync(join(stateDir, MATERIALIZED_SENTINEL))).toBe(true)
    expect(existsSync(join(stateDir, SETUP_SENTINEL))).toBe(true)
    expect(existsSync(join(launchDirectory, '.git'))).toBe(false)
    calls.close()
  }, 60_000)

  it('attaches a replacement host to the running setup script instead of starting it again', async () => {
    const sessionId = 'setup-session-6'
    const root = mkdtempSync(join(tmpdir(), 'atlas-workspace-attach-'))
    const remoteUrl = makeRemote(root)
    const launchDirectory = join(root, 'workspace')
    const workspace = {
      remoteUrl,
      baseBranch: null,
      additionalRepos: [],
      setupScript: 'echo started >> progress.txt && sleep 3 && echo ran >> setup-ran.txt',
    }
    const hostA = await openPorts({ sessionId })

    const dropped = setupFor({
      sessionId,
      calls: hostA.calls,
      processes: hostA.processes,
      files: hostA.files,
      workspace,
      launchDirectory,
    }).catch(() => undefined)
    await waitFor(() => existsSync(join(launchDirectory, 'progress.txt')))
    hostA.calls.close()

    const hostB = await openPorts({ sessionId })
    await setupFor({
      sessionId,
      calls: hostB.calls,
      processes: hostB.processes,
      files: hostB.files,
      workspace,
      launchDirectory,
    })
    await dropped

    expect(await hostB.files.readFile({ path: join(launchDirectory, 'setup-ran.txt') })).toBe(
      'ran\n',
    )
    expect(existsSync(join(root, WORKSPACE_STATE_DIR, SETUP_SENTINEL))).toBe(true)
    hostB.calls.close()
  }, 90_000)
})
