import { describe, expect, it } from 'bun:test'

import { EMcpOauthGrantStatus, EMcpServerSource, type McpOauthServer } from '@dltech/atlas-wire/web'

import { ELinkReturnKind } from '../../personal/link-return'
import {
  EMcpAuthState,
  authStateOf,
  cloudServerOf,
  lastUsedOf,
  mcpOauthReturnOf,
  repoServersOf,
} from '../mcp-oauth'

const URL_A = 'https://mcp.example.com/mcp'

const serverOf = (
  overrides: Partial<McpOauthServer> & Pick<McpOauthServer, 'name' | 'source'>,
): McpOauthServer => ({
  id: `srv_${overrides.name}`,
  url: URL_A,
  status: EMcpOauthGrantStatus.None,
  ...overrides,
})

const CLOUD_A = serverOf({
  name: 'posthog',
  source: EMcpServerSource.Cloud,
  status: EMcpOauthGrantStatus.Connected,
})
const REPO_A = serverOf({
  name: 'linear',
  source: EMcpServerSource.Repo,
  url: URL_A,
})

describe('cloudServerOf', () => {
  it('finds the cloud server by name', () => {
    expect(cloudServerOf([REPO_A, CLOUD_A], 'posthog')).toBe(CLOUD_A)
  })

  it('never matches a repo server of the same name', () => {
    expect(
      cloudServerOf([serverOf({ name: 'posthog', source: EMcpServerSource.Repo })], 'posthog'),
    ).toBeUndefined()
  })

  it('returns undefined when the name is absent', () => {
    expect(cloudServerOf([REPO_A, CLOUD_A], 'missing')).toBeUndefined()
    expect(cloudServerOf([], 'posthog')).toBeUndefined()
  })
})

describe('repoServersOf', () => {
  it('keeps only repo servers', () => {
    expect(repoServersOf([CLOUD_A, REPO_A])).toEqual([REPO_A])
    expect(repoServersOf([])).toEqual([])
    expect(repoServersOf([CLOUD_A])).toEqual([])
  })
})

describe('authStateOf', () => {
  it('maps grant statuses to row states', () => {
    expect(authStateOf(CLOUD_A)).toBe(EMcpAuthState.SignedIn)
    expect(
      authStateOf(
        serverOf({
          name: 'expired',
          source: EMcpServerSource.Cloud,
          status: EMcpOauthGrantStatus.Expired,
        }),
      ),
    ).toBe(EMcpAuthState.SignInAgain)
    expect(authStateOf(REPO_A)).toBe(EMcpAuthState.SignIn)
  })

  it('defaults to SignIn when the server row is missing', () => {
    expect(authStateOf(undefined)).toBe(EMcpAuthState.SignIn)
  })
})

describe('lastUsedOf', () => {
  const now = Date.parse('2026-11-03T12:00:00Z')

  it('formats lastSeenAt relative to now', () => {
    expect(lastUsedOf({ lastSeenAt: '2026-11-03T11:30:00Z', now })).toBe('30m ago')
    expect(lastUsedOf({ lastSeenAt: '2026-10-20T12:00:00Z', now })).toBe('2w ago')
  })

  it('is undefined without a lastSeenAt, and — for garbage', () => {
    expect(lastUsedOf({ lastSeenAt: undefined, now })).toBeUndefined()
    expect(lastUsedOf({ lastSeenAt: 'not a date', now })).toBe('—')
  })
})

describe('mcpOauthReturnOf', () => {
  const params = (query: string) => new URLSearchParams(query)

  it('ignores unrelated visits', () => {
    expect(mcpOauthReturnOf(params(''))).toBeNull()
    expect(mcpOauthReturnOf(params('tab=x'))).toBeNull()
  })

  it('announces success with the server host', () => {
    expect(
      mcpOauthReturnOf(params(`mcpOauth=connected&mcpServer=${encodeURIComponent(URL_A)}`)),
    ).toEqual({
      kind: ELinkReturnKind.Success,
      message: 'Signed in to mcp.example.com',
    })
  })

  it('announces failure with the reason', () => {
    expect(
      mcpOauthReturnOf(
        params(`mcpOauth=failed&mcpServer=${encodeURIComponent(URL_A)}&mcpReason=expired`),
      ),
    ).toEqual({
      kind: ELinkReturnKind.Error,
      message: "Couldn't sign in to mcp.example.com: expired",
    })
  })

  it('falls back when the server or reason is missing', () => {
    expect(mcpOauthReturnOf(params('mcpOauth=failed'))).toEqual({
      kind: ELinkReturnKind.Error,
      message: "Couldn't sign in to the server",
    })
  })
})
