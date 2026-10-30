import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '@dltech/atlas-core'
import { EMcpServerStatus } from '@dltech/atlas-harness'
import { EMcpServerWireStatus } from '@dltech/atlas-wire'

import { mcpStatusWireOf } from '../mcp-status'

const base = { origin: EDefinitionOrigin.Project, definedIn: '/f' }

describe('mcpStatusWireOf', () => {
  it('maps an http server, its status and tool count', () => {
    expect(
      mcpStatusWireOf({
        spec: { name: 'ph', transport: { kind: 'http', url: 'https://ph.test/mcp' }, ...base },
        state: { status: EMcpServerStatus.NeedsAuth },
        tools: 0,
      }),
    ).toEqual({
      name: 'ph',
      transport: 'http',
      url: 'https://ph.test/mcp',
      status: EMcpServerWireStatus.NeedsAuth,
      toolCount: 0,
    })
  })

  it('carries the failure reason for a stdio server', () => {
    expect(
      mcpStatusWireOf({
        spec: { name: 'fs', transport: { kind: 'stdio', command: 'x' }, ...base },
        state: { status: EMcpServerStatus.Failed, error: 'boom' },
        tools: 2,
      }),
    ).toMatchObject({ transport: 'stdio', status: EMcpServerWireStatus.Failed, reason: 'boom' })
  })

  it('reports a disabled server with no transport as none', () => {
    expect(
      mcpStatusWireOf({
        spec: { name: 'off', disabled: true, ...base },
        state: { status: EMcpServerStatus.Disabled },
        tools: 0,
      }),
    ).toMatchObject({ transport: 'none', status: EMcpServerWireStatus.Disabled })
  })
})
