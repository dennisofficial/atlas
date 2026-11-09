import { EDefinitionOrigin } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { EMcpViewStatus } from '../../core'
import { mcpReport, mcpReportRow, NO_MCP_SERVERS } from '../report'

describe('mcpReport', () => {
  it('says so when nothing is configured', () => {
    expect(mcpReport([])).toBe(NO_MCP_SERVERS)
  })

  it('renders one line per server with status, tool count, layer and reason', () => {
    const text = mcpReport([
      {
        name: 'docs',
        transport: 'stdio',
        status: EMcpViewStatus.Connected,
        toolCount: 2,
        layer: EDefinitionOrigin.User,
      },
      {
        name: 'jira',
        transport: 'http',
        status: EMcpViewStatus.Failed,
        toolCount: 0,
        reason: 'connect refused',
        layer: EDefinitionOrigin.Project,
      },
    ])
    expect(text.split('\n')).toEqual([
      'docs Connected 2 tools user',
      'jira Failed 0 tools project: connect refused',
    ])
  })

  it('names needs-auth and a single tool in the singular', () => {
    expect(
      mcpReportRow({
        name: 'gh',
        transport: 'http',
        status: EMcpViewStatus.NeedsAuth,
        toolCount: 1,
        layer: EDefinitionOrigin.BuiltIn,
      }),
    ).toBe('gh NeedsAuth 1 tool built-in')
  })
})
