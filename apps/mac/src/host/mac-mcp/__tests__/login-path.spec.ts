import { describe, expect, test } from 'bun:test'

import { createLoginShellPath } from '../login-path'

const answeringSpawn = (text: string, code = 0) => {
  let calls = 0
  const spawn = ((options: Parameters<typeof Bun.spawn>[0]) => {
    calls += 1
    void options
    return {
      stdout: new Response(text).body,
      exited: Promise.resolve(code),
      kill: () => undefined,
    }
  }) as unknown as typeof Bun.spawn
  return { spawn, calls: () => calls }
}

const hangingSpawn = () => {
  let killed = 0
  let settle: (code: number) => void = () => undefined
  const exited = new Promise<number>((resolve) => {
    settle = resolve
  })
  const spawn = ((options: Parameters<typeof Bun.spawn>[0]) => {
    void options
    return {
      stdout: new ReadableStream<Uint8Array>({ start() {} }),
      exited,
      kill: () => {
        killed += 1
        settle(143)
      },
    }
  }) as unknown as typeof Bun.spawn
  return { spawn, killed: () => killed }
}

describe('createLoginShellPath', () => {
  test('answers with the login shell PATH and memoizes it', async () => {
    const fake = answeringSpawn('/opt/homebrew/bin:/usr/bin')
    const login = createLoginShellPath({ spawn: fake.spawn, env: { PATH: '/usr/bin:/bin' } })

    expect(await login.path()).toBe('/opt/homebrew/bin:/usr/bin')
    expect(await login.path()).toBe('/opt/homebrew/bin:/usr/bin')
    expect(fake.calls()).toBe(1)
  })

  test('falls back to env.PATH when the shell exits non-zero', async () => {
    const fake = answeringSpawn('/usr/local/bin:/usr/bin', 1)
    const login = createLoginShellPath({ spawn: fake.spawn, env: { PATH: '/usr/bin:/bin' } })

    expect(await login.path()).toBe('/usr/bin:/bin')
  })

  test('falls back to env.PATH when the shell never answers', async () => {
    const fake = hangingSpawn()
    const login = createLoginShellPath({
      spawn: fake.spawn,
      env: { PATH: '/usr/bin:/bin' },
      timeoutMs: 20,
    })

    expect(await login.path()).toBe('/usr/bin:/bin')
    expect(fake.killed()).toBe(1)
  })

  test('falls back to env.PATH when the shell cannot be spawned', async () => {
    const spawn = (() => {
      throw new Error('ENOENT: no such file or directory')
    }) as unknown as typeof Bun.spawn
    const login = createLoginShellPath({ spawn, env: { PATH: '/usr/bin:/bin' } })

    expect(await login.path()).toBe('/usr/bin:/bin')
  })
})
