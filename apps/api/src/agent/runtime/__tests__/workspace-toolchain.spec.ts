import { describe, expect, it } from 'bun:test'

import { ensureWorkspace } from '../workspace-setup'
import { installToolchain } from '../workspace-toolchain'
import { RecordingProcessPort, StubFileSystemPort } from './workspace-fakes'

const prepare = async (args: { setupScript: string; miseExitCode?: number }) => {
  const files = new StubFileSystemPort()
  files.directories.add('/workspace/repo')
  const processes = new RecordingProcessPort({
    chunks: ['+ mise install\n'],
    exitCodeOf: (call) =>
      call.cmd.some((part) => part.includes('mise install')) ? (args.miseExitCode ?? 0) : 0,
  })
  const result = await ensureWorkspace({
    calls: { ackScope: () => Promise.resolve(), bootId: () => 'boot-a' },
    processes,
    files,
    workspace: {
      remoteUrl: null,
      baseBranch: null,
      additionalRepos: [],
      setupScript: args.setupScript,
    },
    githubToken: null,
    launchDirectory: '/workspace/repo',
    sandboxName: 'sandbox-a',
  })
  return { result, processes }
}

const indexOf = (processes: RecordingProcessPort, command: string): number =>
  processes.spawned.findIndex((call) => call.cmd.some((part) => part.includes(command)))

describe('workspace toolchain install', () => {
  it('installs the repository pins before the setup script runs', async () => {
    const { processes } = await prepare({ setupScript: 'bun install' })

    const toolchain = indexOf(processes, 'mise install')
    const setup = indexOf(processes, 'bun install')
    expect(toolchain).toBeGreaterThanOrEqual(0)
    expect(setup).toBeGreaterThan(toolchain)
  })

  it('runs mise install non-interactively in the launch directory with the session env', async () => {
    const { processes } = await prepare({ setupScript: 'bun install' })

    const call = processes.spawned.find((spawned) =>
      spawned.cmd.some((part) => part.includes('mise install')),
    )
    expect(call?.cmd).toEqual([
      'sh',
      '-c',
      'command -v mise >/dev/null 2>&1 || exit 0; mise install',
    ])
    expect(call?.cwd).toBe('/workspace/repo')
    expect(call?.env?.MISE_YES).toBe('1')
  })

  it('installs the toolchain even when the repository has no setup script', async () => {
    const { processes } = await prepare({ setupScript: '  ' })

    expect(indexOf(processes, 'mise install')).toBeGreaterThanOrEqual(0)
    expect(indexOf(processes, 'bun install')).toBe(-1)
  })

  it('warns instead of failing prepare when mise install fails, and still runs setup', async () => {
    const { result, processes } = await prepare({ setupScript: 'bun install', miseExitCode: 1 })

    expect(result.ok).toBe(true)
    expect(result.ok ? result.warnings?.join('\n') : '').toContain('toolchain install failed')
    expect(indexOf(processes, 'bun install')).toBeGreaterThan(indexOf(processes, 'mise install'))
  })

  it('returns false and records the output when mise install exits non-zero', async () => {
    const warnings: string[] = []
    const ok = await installToolchain({
      deps: {
        processes: new RecordingProcessPort({
          chunks: ['sh: 1: mise: not found\n'],
          exitCodeOf: () => 127,
        }),
        files: new StubFileSystemPort(),
        warnings,
      },
      launchDirectory: '/workspace/repo',
      scrub: (text) => text,
    })

    expect(ok).toBe(false)
    expect(warnings.join('\n')).toContain('mise: not found')
  })
})
