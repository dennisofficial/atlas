import { describe, expect, it } from 'bun:test'

import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import {
  DaemonAgentFileSystemPort,
  DaemonFileSystemPort,
  DaemonProcessPort,
  RemoteCalls,
  systemTimers,
  type DaemonConnector,
} from '../..'

const SANDBOX = 'atlas-v2-ports-test'
const SECRET = 'ports-test-secret'

const openPorts = async () => {
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
  })
  const connector = (): Promise<DaemonConnector> =>
    Promise.resolve((handlers) => Promise.resolve(daemon.connectRaw(handlers)))
  const calls = new RemoteCalls({
    sessionId: 's-ports',
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector,
    timers: systemTimers,
    onFenced: () => {},
  })
  calls.open({ epoch: 1 })
  await calls.ready()
  return {
    calls,
    daemon,
    files: new DaemonFileSystemPort({ calls }),
    agentFiles: new DaemonAgentFileSystemPort({ calls }),
    processes: new DaemonProcessPort({ calls }),
  }
}

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise
    return undefined
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined
  }
}

describe('daemon-backed ports over the fake daemon', () => {
  it('round-trips write, read, readTextForEdit, readLink, stat, rename, readDirectory and glob', async () => {
    const { files, agentFiles, calls, daemon } = await openPorts()
    await files.mkdir({ path: '/work' })
    await files.writeFile({ path: '/work/a.txt', content: 'alpha' })
    expect(await files.readFile({ path: '/work/a.txt' })).toBe('alpha')
    expect(await agentFiles.readTextForEdit({ path: '/work/a.txt' })).toEqual({
      text: 'alpha',
      strict: 'alpha',
    })
    expect(await files.readLink({ path: '/work/a.txt' })).toBeNull()
    const stat = await agentFiles.stat({ path: '/work/a.txt' })
    expect(stat.isFile()).toBe(true)
    expect(stat.size).toBe(5)
    await files.rename({ from: '/work/a.txt', to: '/work/b.txt' })
    const entries = await files.readDirectory({ path: '/work' })
    expect(entries.map((entry) => entry.name)).toEqual(['b.txt'])
    expect(await files.glob({ pattern: '**/*.txt', cwd: '/work' })).toEqual(['b.txt'])
    await files.removeFile({ path: '/work' })
    expect(await codeOf(files.stat({ path: '/work' }))).toBe('ENOENT')
    calls.close()
    await daemon.stop()
  })

  it('throws an ENOENT-coded error for a missing file', async () => {
    const { files, calls, daemon } = await openPorts()
    expect(await codeOf(files.readFile({ path: '/missing' }))).toBe('ENOENT')
    calls.close()
    await daemon.stop()
  })

  it('spawns and terminates with a non-zero exit', async () => {
    const { processes, calls, daemon } = await openPorts()
    const handle = processes.spawn({
      cmd: ['/bin/sh', '-c', 'echo hi; sleep 30'],
      cwd: '/',
    })
    handle.terminate()
    expect(await handle.exited).toBe(130)
    expect(processes.which({ command: 'rg' })).toBe('rg')
    expect(processes.which({ command: 'nope' })).toBeNull()
    expect(await processes.vendored({ command: 'rg' })).toBeNull()
    calls.close()
    await daemon.stop()
  })
})
