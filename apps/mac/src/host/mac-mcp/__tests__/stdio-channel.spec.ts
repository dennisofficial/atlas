import { describe, expect, test } from 'bun:test'

import type { MacClientFrame } from '@dltech/atlas-protocol/mac-link'

import { openStdioChannel } from '../stdio-channel'

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error('timed out waiting for a frame')
}

const recorder = () => {
  const frames: MacClientFrame[] = []
  const logs: string[] = []
  return {
    frames,
    logs,
    args: {
      channelId: 'c1',
      emit: (frame: MacClientFrame) => {
        frames.push(frame)
      },
      now: () => Date.now(),
      log: (line: string) => {
        logs.push(line)
      },
    },
  }
}

const ECHO = `
process.stdin.on('data', (chunk) => {
  for (const line of chunk.toString().split('\\n')) {
    if (line.trim() === '') continue
    const message = JSON.parse(line)
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n')
  }
})
process.stderr.write('banner: server starting\\n')
`

const capturingSpawn = () => {
  const state: { exited?: Promise<number> } = {}
  const spawn = ((options: Parameters<typeof Bun.spawn>[0]) => {
    const child = Bun.spawn(options)
    state.exited = child.exited
    return child
  }) as unknown as typeof Bun.spawn
  return { state, spawn }
}

describe('openStdioChannel', () => {
  test('relays one reply per request and logs the banner instead of emitting it', async () => {
    const record = recorder()
    const captured = capturingSpawn()
    const channel = await openStdioChannel({
      ...record.args,
      transport: { kind: 'stdio', command: process.execPath, args: ['-e', ECHO] },
      spawn: captured.spawn,
      path: async () => process.env.PATH ?? '',
    })

    channel.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    await waitFor(() => record.frames.length > 0)
    await waitFor(() => record.logs.some((line) => line.includes('banner: server starting')))

    expect(record.frames).toEqual([
      { type: 'rpc', channelId: 'c1', message: { jsonrpc: '2.0', id: 1, result: { ok: true } } },
    ])
    expect(record.logs.some((line) => line.includes('banner: server starting'))).toBe(true)

    channel.close('done')
    await waitFor(() => record.frames.some((frame) => frame.type === 'closed'))
    const closed = record.frames.filter((frame) => frame.type === 'closed')
    expect(closed).toEqual([
      { type: 'closed', channelId: 'c1', reason: 'done: banner: server starting' },
    ])
    expect(await captured.state.exited).toBeDefined()

    expect(() => channel.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).not.toThrow()
    await Bun.sleep(20)
    expect(record.frames.filter((frame) => frame.type === 'closed')).toHaveLength(1)
  })

  test('rejects with ENOENT when the command does not exist', async () => {
    const record = recorder()
    await expect(
      openStdioChannel({
        ...record.args,
        transport: { kind: 'stdio', command: '/nonexistent-atlas-mcp-server' },
        spawn: Bun.spawn,
        path: async () => process.env.PATH ?? '',
      }),
    ).rejects.toThrow(/ENOENT/)
  })

  test('reports stderr in the reason when the process dies on its own', async () => {
    const record = recorder()
    const channel = await openStdioChannel({
      ...record.args,
      transport: {
        kind: 'stdio',
        command: process.execPath,
        args: ['-e', 'process.stderr.write("auth expired\\n"); process.exit(4)'],
      },
      spawn: Bun.spawn,
      path: async () => process.env.PATH ?? '',
    })

    await waitFor(() => record.frames.some((frame) => frame.type === 'closed'))
    const closed = record.frames.find((frame) => frame.type === 'closed')
    expect(closed).toEqual({ type: 'closed', channelId: 'c1', reason: 'exit 4: auth expired' })
    channel.close('done')
  })

  test('spawns with the injected PATH and the spec environment', async () => {
    const record = recorder()
    const seen: { env?: Record<string, string | undefined> | undefined } = {}
    const spawn = ((options: { env?: Record<string, string | undefined> | undefined }) => {
      seen.env = options.env
      return Bun.spawn({
        cmd: [process.execPath, '-e', 'setTimeout(() => undefined, 5_000)'],
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
    }) as unknown as typeof Bun.spawn
    const channel = await openStdioChannel({
      ...record.args,
      transport: {
        kind: 'stdio',
        command: 'paper',
        args: ['mcp'],
        env: { PAPER_TOKEN: 't1' },
      },
      spawn,
      path: async () => '/opt/homebrew/bin:/usr/bin',
    })

    expect(seen.env?.PATH).toBe('/opt/homebrew/bin:/usr/bin')
    expect(seen.env?.PAPER_TOKEN).toBe('t1')
    channel.close('done')
    await waitFor(() => record.frames.some((frame) => frame.type === 'closed'))
  })
})
