import { describe, expect, it } from 'bun:test'

import {
  PORTABLE_ACCOUNT_KIND,
  PORTABLE_MCP_NAME,
  PORTABLE_SETTINGS_NAME,
  PORTABLE_STATE_PATH,
  PORTABLE_STATE_VERSION,
  portableStateSchema,
  type PortableState,
} from '../portable-state'

const KEY_HEX = 'a'.repeat(64)

const account = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'acc_one',
  provider: 'anthropic',
  kind: 'oauth',
  origin: 'login',
  label: 'Claude Code',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  secret: 'sealed-blob',
  ...over,
})

const state = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: PORTABLE_STATE_VERSION,
  vaultKeyHex: KEY_HEX,
  accounts: [account()],
  active: [{ provider: 'anthropic', accountId: 'acc_one' }],
  secrets: [{ name: 'LINEAR_API_KEY', value: 'sealed' }],
  settings: { name: 'settings.json', content: '{}' },
  mcp: { name: 'mcp.json', content: '{}' },
  ...over,
})

describe('PORTABLE_STATE_PATH', () => {
  it('is the bootstrap staging path the drive consumer deletes after install', () => {
    expect(PORTABLE_STATE_PATH).toBe('/atlas/home/bootstrap/local-state.json')
  })
})

describe('wire name constants', () => {
  it('pin the literal file names the materializer writes under the home', () => {
    expect(PORTABLE_SETTINGS_NAME).toBe('settings.json')
    expect(PORTABLE_MCP_NAME).toBe('mcp.json')
    expect(PORTABLE_ACCOUNT_KIND).toBe('api-key')
    expect(PORTABLE_STATE_VERSION).toBe(1)
  })
})

describe('portableStateSchema', () => {
  it('accepts a full snapshot, with settings and mcp optional', () => {
    const full = portableStateSchema.safeParse(state())
    expect(full.success).toBe(true)

    const { settings: _s, mcp: _m, ...bare } = state()
    expect(portableStateSchema.safeParse(bare).success).toBe(true)
  })

  it('rejects a snapshot at any other version', () => {
    expect(portableStateSchema.safeParse(state({ version: 2 })).success).toBe(false)
    expect(portableStateSchema.safeParse(state({ version: '1' })).success).toBe(false)
  })

  it('rejects a malformed vault key', () => {
    expect(portableStateSchema.safeParse(state({ vaultKeyHex: 'short' })).success).toBe(false)
    expect(portableStateSchema.safeParse(state({ vaultKeyHex: 'Z'.repeat(64) })).success).toBe(false)
  })

  it('pins the settings and mcp file names to literal basenames, so a snapshot can never overwrite key or vault', () => {
    expect(
      portableStateSchema.safeParse(state({ settings: { name: 'key', content: '{}' } })).success,
    ).toBe(false)
    expect(
      portableStateSchema.safeParse(state({ settings: { name: 'auth.json', content: '{}' } })).success,
    ).toBe(false)
    expect(
      portableStateSchema.safeParse(state({ mcp: { name: 'secrets.json', content: '{}' } })).success,
    ).toBe(false)
    expect(
      portableStateSchema.safeParse(state({ mcp: { name: 'a/b', content: '{}' } })).success,
    ).toBe(false)
  })

  it('accepts secret names with colons and slashes — they are object keys, never filesystem paths', () => {
    expect(
      portableStateSchema.safeParse(state({ secrets: [{ name: 'mcp:linear/api-key', value: 'sealed' }] })).success,
    ).toBe(true)
  })

  it('rejects secret names with control characters', () => {
    expect(
      portableStateSchema.safeParse(state({ secrets: [{ name: 'bad\nname', value: 'x' }] })).success,
    ).toBe(false)
  })

  it('rejects oversized payloads', () => {
    const huge = 'x'.repeat(4 * 1024 * 1024 + 1)
    expect(portableStateSchema.safeParse(state({ settings: { name: 'settings.json', content: huge } })).success).toBe(false)
    expect(portableStateSchema.safeParse(state({ accounts: [account({ secret: huge })] })).success).toBe(false)

    const many = Array.from({ length: 257 }, (_, i) => account({ id: `acc_${i}` }))
    expect(portableStateSchema.safeParse(state({ accounts: many })).success).toBe(false)
  })

  it('carries token-source provenance as strings, so a newer build still parses', () => {
    const parsed = portableStateSchema.parse(
      state({ accounts: [account({ source: { kind: 'environment', detail: 'ANTHROPIC_API_KEY' } })] }),
    ) as PortableState
    expect(parsed.accounts[0]?.source).toEqual({ kind: 'environment', detail: 'ANTHROPIC_API_KEY' })
  })

  it('carries the omitted-attachment-tokens summary', () => {
    const parsed = portableStateSchema.parse(
      state({
        omitted: {
          oauthAccounts: ['Claude'],
          mcpOauthSecrets: ['mcp-oauth:x'],
          attachmentTokens: ['sandbox-serve:th_1'],
        },
      }),
    )
    expect(parsed.omitted?.attachmentTokens).toEqual(['sandbox-serve:th_1'])
  })
})
