import type { Event, EventId, Hash, RunId } from '@dltech/atlas-core'
import { EDefinitionOrigin, toThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { MCP_VIEW, mcpRosterOfEvents, mcpRosterView } from '../roster'
import { mcpServerChangedSchema, mcpServerRemovedSchema } from '../roster-events'
import { EMcpViewStatus, type McpServerRow } from '../row'

const row = (overrides: Partial<McpServerRow> = {}): McpServerRow => ({
  name: 'docs',
  transport: 'stdio',
  status: EMcpViewStatus.Connected,
  toolCount: 2,
  layer: EDefinitionOrigin.User,
  ...overrides,
})

const stamped = (body: object, seq: number): Event =>
  ({
    id: `e-${seq}` as EventId,
    seq,
    threadId: toThreadId('t1'),
    runId: 'r1' as RunId,
    at: '2026-11-09T10:00:00.000Z',
    epoch: 0,
    depth: 0,
    prevHash: 'p' as Hash,
    ...body,
  }) as unknown as Event

let seq = 0

const changed = (next: McpServerRow): Event => {
  seq += 1
  return stamped({ type: 'mcp-server-changed', row: next }, seq)
}

const removed = (name: string): Event => {
  seq += 1
  return stamped({ type: 'mcp-server-removed', name }, seq)
}

describe('mcpRosterView', () => {
  it('is named mcp and starts empty', () => {
    expect(MCP_VIEW).toBe('mcp')
    expect(mcpRosterView.initial).toEqual([])
  })
})

describe('foldMcpRoster', () => {
  it('adds a connected server with its tool count and layer', () => {
    expect(mcpRosterOfEvents([changed(row())])).toEqual([row()])
  })

  it('replaces the row when the same server fails, keeping one row', () => {
    const state = mcpRosterOfEvents([
      changed(row()),
      changed(row({ status: EMcpViewStatus.Failed, toolCount: 0, reason: 'boom' })),
    ])
    expect(state).toEqual([row({ status: EMcpViewStatus.Failed, toolCount: 0, reason: 'boom' })])
  })

  it('replaces the row when a server needs auth', () => {
    const state = mcpRosterOfEvents([
      changed(row()),
      changed(row({ status: EMcpViewStatus.NeedsAuth })),
    ])
    expect(state.map((kept) => kept.status)).toEqual([EMcpViewStatus.NeedsAuth])
  })

  it('replaces the row when reconcile changes the tool count', () => {
    const state = mcpRosterOfEvents([changed(row()), changed(row({ toolCount: 5 }))])
    expect(state.map((kept) => kept.toolCount)).toEqual([5])
  })

  it('drops a row when the server leaves', () => {
    expect(mcpRosterOfEvents([changed(row()), removed('docs')])).toEqual([])
  })

  it('keeps the roster sorted by first appearance and leaves unrelated events alone', () => {
    const state = mcpRosterOfEvents([
      changed(row({ name: 'zeta' })),
      changed(row()),
      stamped({ type: 'nudge', text: 'hi', lifetimeSteps: 1 }, 99),
    ])
    expect(state.map((kept) => kept.name)).toEqual(['zeta', 'docs'])
  })

  it('throws on a row its schema refuses', () => {
    expect(() => mcpRosterOfEvents([changed({ ...row(), toolCount: -1 })])).toThrow()
  })
})

describe('event schemas', () => {
  it('accepts the changed body and refuses a missing row', () => {
    expect(mcpServerChangedSchema.parse({ type: 'mcp-server-changed', row: row() })).toEqual({
      type: 'mcp-server-changed',
      row: row(),
    })
    expect(() => mcpServerChangedSchema.parse({ type: 'mcp-server-changed' })).toThrow()
  })

  it('accepts the removed body and refuses an empty name', () => {
    expect(mcpServerRemovedSchema.parse({ type: 'mcp-server-removed', name: 'docs' })).toEqual({
      type: 'mcp-server-removed',
      name: 'docs',
    })
    expect(() => mcpServerRemovedSchema.parse({ type: 'mcp-server-removed', name: '' })).toThrow()
  })
})
