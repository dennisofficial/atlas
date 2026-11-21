import type { CallOp, DaemonEvent } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'
import { describe, expect, it } from 'bun:test'

import { mcpGroup } from '..'
import type { DaemonOpsDeps } from '../../deps'

type Rig = {
  events: DaemonEvent[]
  call(op: CallOp): Promise<unknown>
  lines(serverId: string): string[]
  stop(): Promise<void>
}

const deps: DaemonOpsDeps = { env: { PATH: process.env['PATH'] ?? '' }, home: '/tmp' }

const rig = (): Rig => {
  const events: DaemonEvent[] = []
  const group = mcpGroup(deps)({
    publish: (event: DaemonEvent) => void events.push(event),
  } as never)
  const ctx: CallContext = {
    key: 'k',
    signal: new AbortController().signal,
    output: () => undefined,
    publish: () => undefined,
  }
  return {
    events,
    call: async (op) => {
      const registered = group.ops.find((candidate) => candidate.op === op.op)
      if (registered === undefined) throw new Error(`no op ${op.op}`)
      return await registered.run({ op, ctx })
    },
    lines: (serverId) =>
      events.flatMap((event) =>
        event.type === 'mcp.message' && event.serverId === serverId ? [event.line] : [],
      ),
    stop: async () => {
      await group.stop?.()
    },
  }
}

const waitUntil = async (ready: () => boolean, ms = 3_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the server never answered')
}

const serverId = 'ses_1.docs'

describe('mcp.spawn', () => {
  it('spawns a stdio server on the first call and reports that it did', async () => {
    const daemon = rig()
    try {
      const result = await daemon.call({
        op: 'mcp.spawn',
        serverId,
        command: 'cat',
        specHash: 'h1',
      })
      expect(result).toMatchObject({ serverId, attached: false, seq: 0 })
      expect(await daemon.call({ op: 'mcp.list' })).toHaveLength(1)
    } finally {
      await daemon.stop()
    }
  })

  it('attaches to the running server when the spec hash matches, keeping its lines', async () => {
    const daemon = rig()
    try {
      const first = await daemon.call({
        op: 'mcp.spawn',
        serverId,
        command: 'cat',
        specHash: 'h1',
      })
      await daemon.call({ op: 'mcp.send', serverId, line: '{"id":"1"}' })
      await waitUntil(() => daemon.lines(serverId).length === 1)

      const second = await daemon.call({
        op: 'mcp.spawn',
        serverId,
        command: 'cat',
        specHash: 'h1',
      })

      expect(second).toMatchObject({ attached: true, seq: 1 })
      expect(pidOf(second)).toBe(pidOf(first))
    } finally {
      await daemon.stop()
    }
  })

  it('replaces the running server when the spec hash differs', async () => {
    const daemon = rig()
    try {
      const first = await daemon.call({
        op: 'mcp.spawn',
        serverId,
        command: 'cat',
        specHash: 'h1',
      })
      const second = await daemon.call({
        op: 'mcp.spawn',
        serverId,
        command: 'cat',
        specHash: 'h2',
      })

      expect(second).toMatchObject({ attached: false, seq: 0 })
      expect(pidOf(second)).not.toBe(pidOf(first))
      expect(await daemon.call({ op: 'mcp.list' })).toHaveLength(1)
    } finally {
      await daemon.stop()
    }
  })
})

const pidOf = (result: unknown): number | undefined => {
  if (typeof result !== 'object' || result === null) return undefined
  const pid = (result as { pid?: unknown }).pid
  return typeof pid === 'number' ? pid : undefined
}
