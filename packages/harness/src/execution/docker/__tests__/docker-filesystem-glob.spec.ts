import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { DockerFileSystemPort } from '../docker-filesystem'
import { FakeProcesses, type CannedExec } from './fake-processes'

const THREAD = toThreadId('docker-thread')

const STAT_OK: CannedExec = { stdout: '0 41ed 1757900000\n' }

const globbing = (rg: CannedExec): { files: DockerFileSystemPort; processes: FakeProcesses } => {
  const processes = new FakeProcesses((cmd) => (cmd.includes('rg') ? rg : STAT_OK))
  return { files: new DockerFileSystemPort({ processes }), processes }
}

describe('DockerFileSystemPort glob', () => {
  it('runs rg --files without ignore rules and prefixes matches with the cwd', async () => {
    const { files, processes } = globbing({ stdout: 'a.ts\nsub/b.ts\n' })

    const matches = await files.glob({ pattern: '**/*.ts', cwd: '/work', threadId: THREAD })

    expect(matches).toEqual(['/work/a.ts', '/work/sub/b.ts'])
    const rg = processes.spawned.find((spawn) => spawn.cmd.includes('rg'))
    expect(rg?.cwd).toBe('/work')
    expect(rg?.threadId).toBe(THREAD)
    expect(rg?.cmd).toContain('--no-ignore')
    expect(rg?.cmd).toContain('--follow')
    expect(rg?.cmd).toContain('--glob')
    expect(rg?.cmd).toContain('**/*.ts')
  })

  it('passes --hidden only when dot is set', async () => {
    const dotted = globbing({ stdout: '' })
    await dotted.files.glob({ pattern: '*', cwd: '/work', dot: true })
    const withDot = dotted.processes.spawned.find((spawn) => spawn.cmd.includes('rg'))
    expect(withDot?.cmd).toContain('--hidden')

    const plain = globbing({ stdout: '' })
    await plain.files.glob({ pattern: '*', cwd: '/work' })
    const withoutDot = plain.processes.spawned.find((spawn) => spawn.cmd.includes('rg'))
    expect(withoutDot?.cmd).not.toContain('--hidden')
  })

  it('returns no matches when the base directory does not exist', async () => {
    const processes = new FakeProcesses(() => ({
      exitCode: 1,
      stderr: "stat: cannot statx '/work/nope': No such file or directory",
    }))
    const files = new DockerFileSystemPort({ processes })

    const matches = await files.glob({ pattern: '*', cwd: '/work/nope' })

    expect(matches).toEqual([])
    expect(processes.spawned).toHaveLength(1)
  })

  it('terminates the rg process when the signal aborts', async () => {
    const { files, processes } = globbing({ block: true })
    const controller = new AbortController()

    const pending = files.glob({ pattern: '*', cwd: '/work', signal: controller.signal })
    controller.abort()
    const matches = await pending

    expect(processes.terminated).toBe(1)
    expect(matches).toEqual([])
  })

  it('does not spawn when the signal has already aborted', async () => {
    const { files, processes } = globbing({ stdout: '' })
    const controller = new AbortController()
    controller.abort()

    const matches = await files.glob({ pattern: '*', cwd: '/work', signal: controller.signal })

    expect(matches).toEqual([])
    expect(processes.spawned).toHaveLength(0)
  })
})
