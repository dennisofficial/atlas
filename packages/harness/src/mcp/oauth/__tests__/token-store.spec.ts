import { describe, expect, it } from 'bun:test'

import { MemorySecretsStore } from '../../../secrets/memory-store'
import { McpOAuthStore } from '../token-store'

const SERVER_URL = 'https://mcp.example.com/mcp'

const store = () => new McpOAuthStore({ secrets: new MemorySecretsStore() })

describe('McpOAuthStore', () => {
  it('round-trips an entry keyed by the server url', () => {
    const secrets = store()
    secrets.write(SERVER_URL, {
      tokens: { accessToken: 'at', refreshToken: 'rt', expiresAt: '2026-01-01T00:00:00.000Z', scope: 'read' },
      clientInfo: { clientId: 'cid' },
    })

    const read = secrets.read(SERVER_URL)
    expect(read?.tokens?.accessToken).toBe('at')
    expect(read?.clientInfo?.clientId).toBe('cid')
    expect(read?.serverUrl).toBe(new URL(SERVER_URL).toString())
  })

  it('normalizes the url so equivalent forms share one entry', () => {
    const secrets = store()
    secrets.write('https://mcp.example.com:443/mcp', { clientInfo: { clientId: 'cid' } })
    expect(secrets.read('https://mcp.example.com/mcp')?.clientInfo?.clientId).toBe('cid')
  })

  it('returns nothing for an unknown server', () => {
    expect(store().read('https://other.example.com/mcp')).toBeUndefined()
  })

  it('drops a corrupt blob instead of throwing', () => {
    const backing = new MemorySecretsStore()
    const secrets = new McpOAuthStore({ secrets: backing })
    backing.write({ name: `mcp-oauth:${new URL(SERVER_URL).toString()}`, value: '{not json' })
    expect(secrets.read(SERVER_URL)).toBeUndefined()
  })

  it('clearTokens keeps the client registration but drops tokens and verifier', () => {
    const secrets = store()
    secrets.write(SERVER_URL, {
      tokens: { accessToken: 'at' },
      clientInfo: { clientId: 'cid' },
      codeVerifier: 'ver',
    })

    secrets.clearTokens(SERVER_URL)
    const read = secrets.read(SERVER_URL)
    expect(read?.tokens).toBeUndefined()
    expect(read?.codeVerifier).toBeUndefined()
    expect(read?.clientInfo?.clientId).toBe('cid')
  })

  it('remove deletes the whole entry', () => {
    const secrets = store()
    secrets.write(SERVER_URL, { clientInfo: { clientId: 'cid' } })
    secrets.remove(SERVER_URL)
    expect(secrets.read(SERVER_URL)).toBeUndefined()
  })
})
