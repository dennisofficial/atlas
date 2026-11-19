import { describe, expect, it } from 'bun:test'

import { EMcpTransportKind, type McpServerWire } from '@dltech/atlas-wire/web'

import { rowOfServer, upsertOfDraft, upsertOfToggle } from '../mcp-mapping'

type ProxiedServer = McpServerWire & { proxy?: boolean }

const PROXIED_SERVER: ProxiedServer = {
  name: 'paper',
  transport: { kind: EMcpTransportKind.Stdio, command: 'paper' },
  proxy: true,
  updatedAt: '2026-11-19T00:00:00.000Z',
}

describe('upsertOfDraft', () => {
  it('carries proxy into the sealed spec', () => {
    expect(
      upsertOfDraft({ kind: EMcpTransportKind.Stdio, target: 'paper mcp', proxy: true }),
    ).toEqual({
      transport: { kind: EMcpTransportKind.Stdio, command: 'paper', args: ['mcp'] },
      proxy: true,
    })
  })

  it('omits proxy when the switch is off', () => {
    expect(
      upsertOfDraft({ kind: EMcpTransportKind.Stdio, target: 'paper mcp', proxy: false }),
    ).toEqual({
      transport: { kind: EMcpTransportKind.Stdio, command: 'paper', args: ['mcp'] },
    })
  })
})

describe('upsertOfToggle', () => {
  it('keeps proxy when a proxied server is toggled', () => {
    expect(upsertOfToggle({ server: PROXIED_SERVER, enabled: false })).toEqual({
      transport: { kind: EMcpTransportKind.Stdio, command: 'paper' },
      disabled: true,
      proxy: true,
    })
  })
})

describe('rowOfServer', () => {
  it('keeps proxy on the row', () => {
    expect(rowOfServer(PROXIED_SERVER)).toEqual({
      id: 'paper',
      kind: EMcpTransportKind.Stdio,
      target: 'paper',
      enabled: true,
      proxy: true,
    })
  })
})
