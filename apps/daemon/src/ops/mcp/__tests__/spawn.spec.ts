import { describe, expect, it } from 'bun:test'

import { mcpRig, waitUntil } from './rig'

const serverId = 'ses_1.docs'

describe('mcp.spawn', () => {
  it('spawns a stdio server on the first call and reports that it did', async () => {
    const daemon = mcpRig()
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
    const daemon = mcpRig()
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
    const daemon = mcpRig()
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
