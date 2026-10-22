import { describe, expect, it } from 'bun:test'

import type { SpawnCommand, ThreadId } from '@dltech/atlas-core'

import { LocalProcessPort, type LocalProcessHandle } from '../local-process'
import { LOGIN_ENV_MARKER, LoginEnvProcessPort } from '../login-env-process'

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

const idleHandle = (): LocalProcessHandle => ({
  pid: 424242,
  stdout: streamOf(''),
  stderr: streamOf(''),
  exited: Promise.resolve(0),
  terminate: () => undefined,
})

class RecordingProcesses extends LocalProcessPort {
  readonly spawned: SpawnCommand[] = []
  readonly probed: { command: string; threadId?: ThreadId | undefined }[] = []

  override spawn(args: SpawnCommand): LocalProcessHandle {
    this.spawned.push(args)
    return idleHandle()
  }

  override which(args: { command: string; threadId?: ThreadId | undefined }): string | null {
    this.probed.push(args)
    return '/usr/bin/false'
  }
}

const withShell = (shell: string | undefined, run: () => void): void => {
  const before = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  try {
    run()
  } finally {
    if (before === undefined) delete process.env.SHELL
    else process.env.SHELL = before
  }
}

const markedShellCommand: SpawnCommand = {
  cmd: ['bash', '-c', 'node -v'],
  cwd: '/tmp/project',
  env: { PATH: '/usr/bin', [LOGIN_ENV_MARKER]: '1' },
}

describe('LoginEnvProcessPort', () => {
  it('passes unmarked spawns through untouched', () => {
    const inner = new RecordingProcesses()
    const port = new LoginEnvProcessPort(inner)

    port.spawn({ cmd: ['bash', '-c', 'node -v'], cwd: '/tmp', env: { PATH: '/usr/bin' } })

    expect(inner.spawned[0]?.cmd).toEqual(['bash', '-c', 'node -v'])
    expect(inner.spawned[0]?.env).toEqual({ PATH: '/usr/bin' })
  })

  it('routes a marked shell through the zsh login environment, command handed over by env', () => {
    const inner = new RecordingProcesses()
    const port = new LoginEnvProcessPort(inner)

    withShell('/bin/zsh', () => port.spawn(markedShellCommand))

    expect(inner.spawned[0]?.cmd).toEqual(['/bin/zsh', '-ilc', 'exec bash -c "$ATLAS_SHELL_COMMAND"'])
    expect(inner.spawned[0]?.cwd).toBe('/tmp/project')
    expect(inner.spawned[0]?.env?.ATLAS_SHELL_COMMAND).toBe('node -v')
    expect(inner.spawned[0]?.env?.[LOGIN_ENV_MARKER]).toBeUndefined()
  })

  it('quiets fnm chatter, overriding the FNM_LOGLEVEL=info fnm itself exports into every shell', () => {
    const inner = new RecordingProcesses()
    const port = new LoginEnvProcessPort(inner)

    withShell('/bin/zsh', () =>
      port.spawn({ ...markedShellCommand, env: { ...markedShellCommand.env, FNM_LOGLEVEL: 'info' } }),
    )

    expect(inner.spawned[0]?.env?.FNM_LOGLEVEL).toBe('quiet')
  })

  it('gives bash login-only flags, because bash -i without a tty prints job-control noise', () => {
    const inner = new RecordingProcesses()
    const port = new LoginEnvProcessPort(inner)

    withShell('/bin/bash', () => port.spawn(markedShellCommand))

    expect(inner.spawned[0]?.cmd).toEqual(['/bin/bash', '-lc', 'exec bash -c "$ATLAS_SHELL_COMMAND"'])
  })

  it('falls back to plain bash when SHELL is not set', () => {
    const inner = new RecordingProcesses()
    const port = new LoginEnvProcessPort(inner)

    withShell(undefined, () => port.spawn(markedShellCommand))

    expect(inner.spawned[0]?.cmd).toEqual(['bash', '-lc', 'exec bash -c "$ATLAS_SHELL_COMMAND"'])
  })

  it('leaves a marked spawn alone when it is not a bash -c command', () => {
    const inner = new RecordingProcesses()
    const port = new LoginEnvProcessPort(inner)

    port.spawn({ cmd: ['sleep', '5'], cwd: '/tmp', env: { [LOGIN_ENV_MARKER]: '1' } })

    expect(inner.spawned[0]?.cmd).toEqual(['sleep', '5'])
  })

  it('delegates the non-spawn surface to the inner port', () => {
    const inner = new RecordingProcesses()
    const port = new LoginEnvProcessPort(inner)

    expect(port.which({ command: 'git' })).toBe('/usr/bin/false')
    expect(inner.probed).toEqual([{ command: 'git' }])
  })

  it('keeps terminate idempotent across the startup retry wrapper', () => {
    const inner = new RecordingProcesses()
    const port = new LoginEnvProcessPort(inner)

    const handle = port.spawn(markedShellCommand)
    handle.terminate()
    handle.terminate()
  })
})
