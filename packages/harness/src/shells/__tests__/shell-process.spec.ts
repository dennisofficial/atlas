import { describe, expect, it } from 'bun:test'

import type {
  ProcessHandle,
  ProcessPort,
  SpawnCommand,
  ThreadId,
  ToolOutputChunk,
} from '@dltech/atlas-core'

import { LOGIN_ENV_MARKER } from '../../execution/login-env-process'
import { readShell, startShell, type Shell } from '../shell-process'

const after = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const openShell = (command: string): Shell => {
  const started = startShell({ command, cwd: process.cwd() })
  if (!started.ok) throw new Error(started.reason)
  return started.shell
}

const stdoutOf = (chunks: readonly ToolOutputChunk[]): string =>
  chunks.flatMap((chunk) => (chunk.stream === 'stdout' ? [chunk.text] : [])).join('')

const stderrOf = (chunks: readonly ToolOutputChunk[]): string =>
  chunks.flatMap((chunk) => (chunk.stream === 'stderr' ? [chunk.text] : [])).join('')

const idleHandle = (): ProcessHandle => ({
  stdout: new ReadableStream({ start: (controller) => controller.close() }),
  stderr: new ReadableStream({ start: (controller) => controller.close() }),
  exited: Promise.resolve(0),
  terminate: () => undefined,
})

class RecordingProcesses implements ProcessPort {
  readonly spawned: SpawnCommand[] = []

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    return idleHandle()
  }

  which(_args: { command: string; threadId?: ThreadId | undefined }): string | null {
    return null
  }
}

describe('starting a shell', () => {
  it('marks the spawn so a host-side port can resolve the login-shell environment', () => {
    const processes = new RecordingProcesses()

    const started = startShell({ command: 'node -v', cwd: '/tmp/project', processes })

    expect(started.ok).toBe(true)
    expect(processes.spawned[0]?.cmd).toEqual(['bash', '-c', 'node -v'])
    expect(processes.spawned[0]?.env?.[LOGIN_ENV_MARKER]).toBe('1')
  })
})

describe('tapping a foreground shell while it runs', () => {
  it('hands every chunk to the listener, tagged with the stream it came from', async () => {
    const chunks: ToolOutputChunk[] = []
    const shell = openShell(`printf 'one\\n'; sleep 0.2; printf 'two\\n'; printf 'err\\n' >&2`)

    const read = await readShell({ shell, limit: 1_000, onOutput: (chunk) => chunks.push(chunk) })

    expect(chunks.length).toBeGreaterThanOrEqual(3)
    expect(stdoutOf(chunks)).toBe('one\ntwo\n')
    expect(stderrOf(chunks)).toBe('err\n')
    expect(chunks.some((chunk) => chunk.text === '')).toBe(false)
    expect(read).toEqual({
      stdout: { text: 'one\ntwo\n', droppedLines: 0, truncated: false },
      stderr: { text: 'err\n', droppedLines: 0, truncated: false },
      exitCode: 0,
    })
  })

  it('fires while the command is still running, not when it returns', async () => {
    const chunks: ToolOutputChunk[] = []
    const shell = openShell(`printf 'early\\n'; sleep 0.4; printf 'late\\n'`)

    const reading = readShell({ shell, limit: 1_000, onOutput: (chunk) => chunks.push(chunk) })
    await after(150)

    expect(stdoutOf(chunks)).toBe('early\n')

    const read = await reading
    expect(read.stdout.text).toBe('early\nlate\n')
    expect(stdoutOf(chunks)).toBe('early\nlate\n')
  })

  it('sees what the capped tail has already dropped, without changing the result', async () => {
    const chunks: ToolOutputChunk[] = []
    const shell = openShell(`printf 'abcdefghijklmnopqrst\\n'`)

    const read = await readShell({ shell, limit: 12, onOutput: (chunk) => chunks.push(chunk) })

    expect(stdoutOf(chunks)).toBe('abcdefghijklmnopqrst\n')
    expect(read.stdout.truncated).toBe(true)
    expect(read.stdout.text.length).toBeLessThanOrEqual(12)
    expect(read.stdout.text).toBe('jklmnopqrst\n')
  })

  it('returns the same result when nobody is listening', async () => {
    const read = await readShell({ shell: openShell(`printf 'plain\\n'`), limit: 1_000 })

    expect(read.stdout.text).toBe('plain\n')
    expect(read.exitCode).toBe(0)
  })
})
