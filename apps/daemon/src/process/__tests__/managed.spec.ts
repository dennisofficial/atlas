import { describe, expect, it } from 'bun:test'

import { ManagedProcess } from '../managed'

const collect = (): { text(): string; handler(bytes: Uint8Array): void } => {
  const parts: string[] = []
  return {
    text: () => parts.join(''),
    handler: (bytes) => void parts.push(new TextDecoder().decode(bytes)),
  }
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
