import { EDefinitionOrigin } from '@dltech/atlas-core'

import { EMcpViewStatus, type McpServerRow } from '../../core'
import { describe, expect, it } from 'bun:test'

import { mcpRosterDraftsOf, rowsOf } from '../roster'
import { EMcpServerStatus, type McpToolsSnapshot } from '../snapshot'

const snapshotOf = (args: {
  status: EMcpServerStatus
  reason?: string
  tools?: readonly string[]
}): McpToolsSnapshot => ({
  configHash: 'h',
  directory: '/repo',
  servers: [
    {
      name: 'docs',
      origin: EDefinitionOrigin.User,
      transportKind: 'stdio',
      configHash: 'c1',
      status: args.status,
      tools: (args.tools ?? []).map((name) => ({ name })),
      ...(args.reason === undefined ? {} : { reason: args.reason }),
    },
  ],
})

describe('the mcp view event body', () => {
  it('appends one changed row when a server connects', () => {
    const rows = rowsOf(snapshotOf({ status: EMcpServerStatus.Connected, tools: ['search'] }))
    expect(mcpRosterDraftsOf({ previous: [], next: rows })).toEqual([
      {
        type: 'mcp-server-changed',
        row: {
          name: 'docs',
          transport: 'stdio',
          status: EMcpViewStatus.Connected,
          toolCount: 1,
          layer: EDefinitionOrigin.User,
        },
      },
    ])
  })

  it('appends a failed row with its reason', () => {
    const rows = rowsOf(snapshotOf({ status: EMcpServerStatus.Failed, reason: 'boom' }))
    expect(mcpRosterDraftsOf({ previous: [], next: rows })[0]).toMatchObject({
      type: 'mcp-server-changed',
      row: { name: 'docs', status: EMcpViewStatus.Failed, toolCount: 0, reason: 'boom' },
    })
  })

  it('appends nothing when no row changed', () => {
    const rows: readonly McpServerRow[] = rowsOf(
      snapshotOf({ status: EMcpServerStatus.Connected, tools: ['s'] }),
    )
    expect(mcpRosterDraftsOf({ previous: rows, next: rows })).toEqual([])
  })

  it('appends a change when only the status flips', () => {
    const connected = rowsOf(snapshotOf({ status: EMcpServerStatus.Connected, tools: ['s'] }))
    const unavailable = rowsOf(
      snapshotOf({ status: EMcpServerStatus.Failed, reason: 'Mac app offline' }),
    )
    expect(mcpRosterDraftsOf({ previous: connected, next: unavailable })).toHaveLength(1)
  })

  it('appends a removal when a server leaves the config', () => {
    const before = rowsOf(snapshotOf({ status: EMcpServerStatus.Connected, tools: ['s'] }))
    expect(mcpRosterDraftsOf({ previous: before, next: [] })).toEqual([
      { type: 'mcp-server-removed', name: 'docs' },
    ])
  })
})
