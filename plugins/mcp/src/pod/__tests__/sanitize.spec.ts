import { EDefinitionOrigin } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import type { LoadedMcpEntry } from '../../core'
import { configHashOf, specHashOf } from '../sanitize'

const entryOf = (over: Partial<LoadedMcpEntry> = {}): LoadedMcpEntry => ({
  name: 'posthog',
  transport: { kind: 'http', url: 'https://mcp.test/mcp', headers: { 'x-api-key': 'k1' } },
  origin: EDefinitionOrigin.User,
  definedIn: 'the cloud',
  source: 'cloud',
  ...over,
})

const stdioOf = (env: string): LoadedMcpEntry =>
  entryOf({ transport: { kind: 'stdio', command: 'bun', env: { MCP_KEY: env } } })

describe('the config hash', () => {
  it('ignores the oauth access token', () => {
    expect(configHashOf(entryOf({ accessToken: 'token-1' }))).toBe(
      configHashOf(entryOf({ accessToken: 'token-2' })),
    )
    expect(configHashOf(entryOf())).toBe(configHashOf(entryOf({ accessToken: 'token-1' })))
  })

  it('ignores the oauth access token in the spec hash', () => {
    expect(specHashOf(entryOf({ accessToken: 'token-1' }))).toBe(
      specHashOf(entryOf({ accessToken: 'token-2' })),
    )
    expect(specHashOf(entryOf())).toBe(specHashOf(entryOf({ accessToken: 'token-1' })))
  })

  it('still changes when a header value changes', () => {
    const other = entryOf({
      transport: { kind: 'http', url: 'https://mcp.test/mcp', headers: { 'x-api-key': 'k2' } },
    })
    expect(configHashOf(entryOf())).not.toBe(configHashOf(other))
    expect(specHashOf(entryOf())).not.toBe(specHashOf(other))
  })

  it('still changes when an env value changes', () => {
    expect(configHashOf(stdioOf('a'))).not.toBe(configHashOf(stdioOf('b')))
    expect(specHashOf(stdioOf('a'))).not.toBe(specHashOf(stdioOf('b')))
  })
})
