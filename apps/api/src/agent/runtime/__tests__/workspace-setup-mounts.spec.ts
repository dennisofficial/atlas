import { describe, expect, it } from 'bun:test'

import { ProcessPort, type ProcessHandle, type SpawnCommand } from '@dltech/atlas-core'

import { ensureWorkspace } from '../workspace-setup'
import { StubFileSystemPort } from './workspace-fakes'

const LAUNCH = '/atlas/workspaces/repo'
const HOME = '/home/user'
const EXCLUDE = `${LAUNCH}/.git/info/exclude`

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (sink) => {
      if (text !== '') sink.enqueue(new TextEncoder().encode(text))
      sink.close()
    },
  })

const stdoutOf = (cmd: readonly string[]): string => {
  if (cmd[0] === 'sh' && cmd[2] === 'printf %s "$HOME"') return HOME
  return cmd.includes('--git-path') ? EXCLUDE : ''
}

const exitCodeOf = (cmd: readonly string[]): number =>
  cmd.includes('ls-files') || cmd.includes('check-ignore') ? 1 : 0

class OrderedProcesses extends ProcessPort {
  constructor(private readonly log: string[]) {
    super()
  }

  override spawn(args: SpawnCommand): ProcessHandle {
    this.log.push(`spawn ${args.cmd.join(' ')}`)
    return {
      stdout: streamOf(stdoutOf(args.cmd)),
      stderr: streamOf(''),
      exited: Promise.resolve(exitCodeOf(args.cmd)),
      terminate: () => {},
    }
  }

  override which(): string | null {
    return null
  }
}

class OrderedFiles extends StubFileSystemPort {
  constructor(private readonly log: string[]) {
    super()
  }

  override writeFile(args: {
    path: string
    content: string | Uint8Array
    mode?: number | undefined
  }): Promise<void> {
    this.log.push(`write ${args.path}`)
    return super.writeFile(args)
  }

  override rename(args: { from: string; to: string }): Promise<void> {
    this.log.push(`rename ${args.from} ${args.to}`)
    return super.rename(args)
  }
}

describe('ensureWorkspace project file mounts', () => {
  it('writes the mounts after the clone and before the setup script', async () => {
    const log: string[] = []
    const files = new OrderedFiles(log)

    const result = await ensureWorkspace({
      calls: { ackScope: async () => undefined },
      processes: new OrderedProcesses(log),
      files,
      workspace: {
        remoteUrl: 'https://github.com/acme/repo.git',
        baseBranch: 'main',
        additionalRepos: [],
        setupScript: 'echo setup',
      },
      githubToken: null,
      launchDirectory: LAUNCH,
      sandboxName: 'sandbox-a',
      mounts: [{ path: '.env.keys', contents: 'KEY=1', mode: 0o600 }],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const cloned = log.findIndex((entry) => entry.startsWith('spawn git clone'))
    const mounted = log.findIndex(
      (entry) => entry.startsWith('rename ') && entry.endsWith(` ${LAUNCH}/.env.keys`),
    )
    const setup = log.indexOf('spawn sh -c echo setup')

    expect(cloned).toBeGreaterThanOrEqual(0)
    expect(mounted).toBeGreaterThan(cloned)
    expect(setup).toBeGreaterThan(mounted)
    expect(files.contents.get(`${LAUNCH}/.env.keys`)).toBe('KEY=1')
    expect(result.ok).toBe(true)
    expect(result.ok ? result.notices?.length : 0).toBe(1)
  })
})
