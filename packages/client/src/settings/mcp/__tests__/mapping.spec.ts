import { describe, expect, it } from 'bun:test'

import { EMcpTransportKind, type McpServerWire } from '@dltech/atlas-wire/web'

import {
  mcpDraftIsValid,
  rowOfServer,
  serverIdOf,
  targetOf,
  upsertOfDraft,
  upsertOfServerDraft,
  upsertOfToggle,
} from '../mapping'

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

  it('reads headers for an http server and env for a stdio server', () => {
    expect(
      upsertOfDraft({
        kind: EMcpTransportKind.Http,
        target: 'https://mcp.example.com/mcp',
        extra: 'Authorization: Bearer t',
      }),
    ).toEqual({
      transport: {
        kind: EMcpTransportKind.Http,
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer t' },
      },
    })
    expect(
      upsertOfDraft({ kind: EMcpTransportKind.Stdio, target: 'bunx tool', extra: 'A=1' }),
    ).toEqual({
      transport: {
        kind: EMcpTransportKind.Stdio,
        command: 'bunx',
        args: ['tool'],
        env: { A: '1' },
      },
    })
  })
})

describe('upsertOfServerDraft', () => {
  it('always enables the server it writes', () => {
    expect(
      upsertOfServerDraft({
        id: 'ios-settings-check',
        kind: EMcpTransportKind.Http,
        target: 'https://example.com/mcp',
        extra: '',
        proxy: false,
      }),
    ).toEqual({
      transport: { kind: EMcpTransportKind.Http, url: 'https://example.com/mcp' },
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

describe('targetOf', () => {
  it('reads a command line or a url, and nothing for a server without a transport', () => {
    expect(targetOf({ kind: EMcpTransportKind.Stdio, command: 'bunx', args: ['tool'] })).toBe(
      'bunx tool',
    )
    expect(targetOf({ kind: EMcpTransportKind.Http, url: 'https://a.test/mcp' })).toBe(
      'https://a.test/mcp',
    )
    expect(targetOf(undefined)).toBe('')
  })
})

describe('serverIdOf', () => {
  it('slugs a display name into a server id', () => {
    expect(serverIdOf('My Filesystem Server')).toBe('my-filesystem-server')
    expect(serverIdOf('  Filesystem! ')).toBe('filesystem')
    expect(serverIdOf('###')).toBe('')
  })
})

describe('mcpDraftIsValid', () => {
  const base = {
    id: 'paper',
    kind: EMcpTransportKind.Stdio,
    target: 'paper mcp',
    extra: '',
    proxy: false,
  }

  it('needs an id and a target', () => {
    expect(mcpDraftIsValid(base)).toBe(true)
    expect(mcpDraftIsValid({ ...base, id: '' })).toBe(false)
    expect(mcpDraftIsValid({ ...base, id: 'has space' })).toBe(false)
    expect(mcpDraftIsValid({ ...base, target: '   ' })).toBe(false)
  })
})
