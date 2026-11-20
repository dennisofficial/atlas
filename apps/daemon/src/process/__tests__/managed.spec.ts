import { describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'

import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'

import { ManagedProcess } from '../managed'

const collect = (): { text(): string; handler(bytes: Uint8Array): void } => {
  const parts: string[] = []
  return {
    text: () => parts.join(''),
    handler: (bytes) => void parts.push(new TextDecoder().decode(bytes)),
  }
}

const spawnFailure = (args: { cmd: string[]; cwd: string }): CallFailureError['failure'] => {
  try {
    ManagedProcess.spawn({
      cmd: args.cmd,
      cwd: args.cwd,
      env: { PATH: process.env.PATH },
      onStdout: () => {},
      onStderr: () => {},
    })
  } catch (error) {
    if (error instanceof CallFailureError) return error.failure
    throw error
  }
  throw new Error('spawn did not fail')
}

describe('ManagedProcess input', () => {
  it('pipes written bytes to the child and ends it on close', async () => {
    const out = collect()
    const child = ManagedProcess.spawn({
      cmd: ['cat'],
      env: { PATH: process.env.PATH },
      onStdout: out.handler,
      onStderr: () => {},
      input: true,
    })
    expect(child.acceptsInput()).toBe(true)
    expect(child.writeInput(new TextEncoder().encode('hello\n'))).toBe(true)
    child.closeInput()
    const exit = await child.exit()
    expect(exit.exitCode).toBe(0)
    expect(out.text()).toBe('hello\n')
  })

  it('refuses input when it was not asked for', async () => {
    const child = ManagedProcess.spawn({
      cmd: ['cat'],
      env: { PATH: process.env.PATH },
      onStdout: () => {},
      onStderr: () => {},
    })
    expect(child.acceptsInput()).toBe(false)
    expect(child.writeInput(new TextEncoder().encode('x'))).toBe(false)
    expect((await child.exit()).exitCode).toBe(0)
  })
})

describe('ManagedProcess spawn failure', () => {
  it('names a missing working directory instead of the shell', () => {
    const failure = spawnFailure({ cmd: ['/bin/sh', '-c', 'true'], cwd: '/nonexistent-dir/tree' })
    expect(failure.code).toBe(ECallFailure.SpawnFailed)
    expect(failure.message).toBe('the working directory /nonexistent-dir/tree does not exist')
  })

  it('keeps the spawn error for a missing binary in a real directory', () => {
    const failure = spawnFailure({ cmd: ['/nonexistent/tool'], cwd: tmpdir() })
    expect(failure.code).toBe(ECallFailure.SpawnFailed)
    expect(failure.message).toContain('/nonexistent/tool')
  })
})
