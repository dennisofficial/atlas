import { describe, expect, test } from 'bun:test'

import type { JsonRpcMessage, MacClientFrame } from '@dltech/atlas-protocol/mac-link'

import { createMacMcpRunner, type MacMcpRunnerArgs } from '../runner'

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error('timed out waiting for a frame')
}

const createFakeChild = () => {
  const writes: string[] = []
  const kills: string[] = []
  let settle: (code: number) => void = () => undefined
  const exited = new Promise<number>((resolve) => {
    settle = resolve
  })
  let out: ReadableStreamDefaultController<Uint8Array> | undefined
  let err: ReadableStreamDefaultController<Uint8Array> | undefined
  const stdout = new ReadableStream<Uint8Array>({
    start: (controller) => {
      out = controller
    },
  })
  const stderr = new ReadableStream<Uint8Array>({
    start: (controller) => {
      err = controller
    },
  })
  let ended = false
  const encoder = new TextEncoder()
  const end = (code: number, signal?: string): void => {
    if (signal !== undefined) kills.push(signal)
    if (ended) return
    ended = true
    settle(code)
    out?.close()
    err?.close()
  }
  return {
    child: {
      stdin: {
        write: (chunk: string) => {
          writes.push(chunk)
        },
        flush: async () => undefined,
      },
      stdout,
      stderr,
      exited,
      kill: (signal: string) => end(0, signal),
    },
    writes: () => writes,
    kills: () => kills,
    emit: (message: JsonRpcMessage) => out?.enqueue(encoder.encode(`${JSON.stringify(message)}\n`)),
    die: (code: number) => end(code),
  }
}

const fakeTimers = () => {
  const ticks: (() => void)[] = []
  let active = true
  const setIntervalFn = ((handler: () => void) => {
    ticks.push(handler)
    active = true
    return ticks.length as unknown as ReturnType<typeof setInterval>
  }) as unknown as typeof setInterval
  const clearIntervalFn = (() => {
    active = false
  }) as unknown as typeof clearInterval
  return {
    timers: { setInterval: setIntervalFn, clearInterval: clearIntervalFn },
    tick: () => {
      for (const handler of ticks) handler()
    },
    active: () => active,
  }
}

const stdio = (env?: Record<string, string>) => ({
  name: 'paper',
  transport: {
    kind: 'stdio' as const,
    command: 'paper',
    args: ['mcp'],
    ...(env === undefined ? {} : { env }),
  },
})

const remote = () => ({
  name: 'remote',
  transport: { kind: 'http' as const, url: 'http://127.0.0.1:9/mcp' },
})

const harness = (overrides: Partial<MacMcpRunnerArgs> = {}) => {
  const frames: MacClientFrame[] = []
  const spawns: {
    cmd: string[] | undefined
    env: Record<string, string | undefined> | undefined
    child: ReturnType<typeof createFakeChild>
  }[] = []
  const spawn = ((options: { cmd?: string[]; env?: Record<string, string | undefined> }) => {
    const child = createFakeChild()
    spawns.push({ cmd: options.cmd, env: options.env, child })
    return child.child
  }) as unknown as typeof Bun.spawn
  const timers = fakeTimers()
  let clock = 0
  const runner = createMacMcpRunner({
    emit: (frame) => {
      frames.push(frame)
    },
    spawn,
    path: async () => '/opt/homebrew/bin:/usr/bin',
    now: () => clock,
    timers: timers.timers,
    ...overrides,
  })
  return {
    runner,
    frames,
    spawns,
    timers,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const closedFrames = (frames: readonly MacClientFrame[]) =>
  frames.filter((frame) => frame.type === 'closed')

describe('createMacMcpRunner', () => {
  test('opens a stdio channel with the login PATH and the spec environment', async () => {
    const h = harness()
    h.runner.open({ channelId: 'a', server: stdio({ PAPER_TOKEN: 't1' }) })
    await waitFor(() => h.frames.some((frame) => frame.type === 'opened'))

    expect(h.frames).toEqual([{ type: 'opened', channelId: 'a' }])
    expect(h.spawns[0]?.cmd).toEqual(['paper', 'mcp'])
    expect(h.spawns[0]?.env?.PATH).toBe('/opt/homebrew/bin:/usr/bin')
    expect(h.spawns[0]?.env?.PAPER_TOKEN).toBe('t1')
    expect(h.runner.active()).toEqual(['a'])
    h.runner.stop()
  })

  test('relays rpc in both directions and drops the channel when the child exits', async () => {
    const h = harness()
    h.runner.open({ channelId: 'a', server: stdio() })
    await waitFor(() => h.frames.some((frame) => frame.type === 'opened'))

    h.runner.rpc({ channelId: 'a', message: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    await waitFor(() => (h.spawns[0]?.child.writes().length ?? 0) > 0)
    expect(JSON.parse(h.spawns[0]?.child.writes()[0] ?? '')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })

    h.spawns[0]?.child.emit({ jsonrpc: '2.0', id: 1, result: { tools: [] } })
    await waitFor(() => h.frames.some((frame) => frame.type === 'rpc'))
    expect(h.frames.at(-1)).toEqual({
      type: 'rpc',
      channelId: 'a',
      message: { jsonrpc: '2.0', id: 1, result: { tools: [] } },
    })

    h.spawns[0]?.child.die(3)
    await waitFor(() => closedFrames(h.frames).length === 1)
    expect(closedFrames(h.frames)).toEqual([{ type: 'closed', channelId: 'a', reason: 'exit 3' }])
    expect(h.runner.active()).toEqual([])

    h.spawns[0]?.child.die(3)
    await Bun.sleep(20)
    expect(closedFrames(h.frames)).toHaveLength(1)
    h.runner.stop()
  })

  test('tells the host an unknown channel is closed', () => {
    const h = harness()
    h.runner.rpc({ channelId: 'missing', message: { jsonrpc: '2.0', id: 1, method: 'ping' } })
    expect(h.frames).toEqual([{ type: 'closed', channelId: 'missing', reason: 'unknown channel' }])
    h.runner.stop()
  })

  test('a close frame kills the child and reports closed by the host', async () => {
    const h = harness()
    h.runner.open({ channelId: 'a', server: stdio() })
    await waitFor(() => h.frames.some((frame) => frame.type === 'opened'))

    h.runner.close({ channelId: 'a' })
    await waitFor(() => closedFrames(h.frames).length === 1)
    expect(h.spawns[0]?.child.kills()).toEqual(['SIGTERM'])
    expect(closedFrames(h.frames)).toEqual([
      { type: 'closed', channelId: 'a', reason: 'closed by the host' },
    ])
    expect(h.runner.active()).toEqual([])
    h.runner.stop()
  })

  test('disconnected closes every channel and stop clears the reaper', async () => {
    const h = harness()
    h.runner.open({ channelId: 'a', server: stdio() })
    h.runner.open({ channelId: 'b', server: remote() })
    await waitFor(() => h.frames.filter((frame) => frame.type === 'opened').length === 2)

    h.runner.disconnected()
    await waitFor(() => closedFrames(h.frames).length === 2)
    expect(closedFrames(h.frames).map((frame) => frame.type === 'closed' && frame.reason)).toEqual([
      'mac-link-closed',
      'mac-link-closed',
    ])
    expect(h.runner.active()).toEqual([])

    h.runner.stop()
    expect(h.timers.active()).toBe(false)
    h.runner.stop()
  })

  test('reaps a channel idle for 30 minutes and spares one used at 29', async () => {
    const h = harness()
    h.runner.open({ channelId: 'idle', server: stdio() })
    h.runner.open({ channelId: 'used', server: stdio() })
    await waitFor(() => h.frames.filter((frame) => frame.type === 'opened').length === 2)

    h.advance(29 * 60_000)
    h.runner.rpc({ channelId: 'used', message: { jsonrpc: '2.0', method: 'ping' } })
    h.timers.tick()
    await Bun.sleep(20)
    expect(closedFrames(h.frames)).toHaveLength(0)

    h.advance(60_001)
    h.timers.tick()
    await waitFor(() => closedFrames(h.frames).length === 1)
    expect(closedFrames(h.frames)).toEqual([
      { type: 'closed', channelId: 'idle', reason: 'idle for 30 minutes' },
    ])
    expect(h.runner.active()).toEqual(['used'])
    h.runner.stop()
  })

  test('a second open replaces the first channel', async () => {
    const h = harness()
    h.runner.open({ channelId: 'a', server: stdio() })
    await waitFor(() => h.frames.some((frame) => frame.type === 'opened'))

    h.runner.open({ channelId: 'a', server: stdio({ SECOND: '1' }) })
    await waitFor(() => h.frames.filter((frame) => frame.type === 'opened').length === 2)

    expect(closedFrames(h.frames)).toEqual([{ type: 'closed', channelId: 'a', reason: 'replaced' }])
    expect(h.runner.active()).toEqual(['a'])
    expect(h.spawns).toHaveLength(2)
    h.runner.stop()
  })

  test('an open whose spawn fails emits open-failed once', async () => {
    const spawn = (() => {
      throw new Error("ENOENT: no such file or directory, posix_spawn 'paper'")
    }) as unknown as typeof Bun.spawn
    const h = harness({ spawn })
    h.runner.open({ channelId: 'a', server: stdio() })
    await waitFor(() => h.frames.length > 0)
    await Bun.sleep(20)

    expect(h.frames).toHaveLength(1)
    expect(h.frames[0]).toMatchObject({ type: 'open-failed', channelId: 'a' })
    expect(h.frames[0]?.type === 'open-failed' && h.frames[0].reason).toContain('ENOENT')
    h.runner.stop()
  })
})
