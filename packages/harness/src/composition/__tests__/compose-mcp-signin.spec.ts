import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '@dltech/atlas-core'

import { EMcpAuthOutcome } from '../../mcp/oauth/flow'
import { EMcpServerStatus } from '../../mcp/registry/handle-status'
import type { RegisteredMcp } from '../../mcp/registry/register-mcp'
import { signInFor } from '../compose-mcp'

const mcpWith = (status: EMcpServerStatus): RegisteredMcp => {
  const spec = {
    name: 'ph',
    transport: { kind: 'http' as const, url: 'https://ph.test/mcp' },
    origin: EDefinitionOrigin.Project,
    definedIn: '/f',
  }
  const state = status === EMcpServerStatus.Failed ? { status, error: 'x' } : { status }
  const store = {
    servers: () => [{ spec, state, tools: 0 }],
    challengeOf: () => undefined,
    reconnect: async () => undefined,
    statusOf: () => ({ spec, state }),
  }
  return {
    store,
    rejections: [],
    connected: Promise.resolve(),
    refresh: async () => undefined,
    signIn: async () => ({
      outcome: EMcpAuthOutcome.Authorized,
      tokens: { accessToken: 't' },
    }),
  } as unknown as RegisteredMcp
}

describe('signInFor', () => {
  it('reports failure when the reconnected server is not Connected', async () => {
    const signIn = signInFor(mcpWith(EMcpServerStatus.NeedsAuth))
    expect(await signIn?.({ serverName: 'ph' })).toEqual({
      ok: false,
      detail: "signed in, but 'ph' did not connect (needs-auth)",
    })
  })

  it('reports success when it connects', async () => {
    const signIn = signInFor(mcpWith(EMcpServerStatus.Connected))
    expect(await signIn?.({ serverName: 'ph' })).toEqual({ ok: true, detail: "signed in to 'ph'" })
  })
})
