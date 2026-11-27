import { describe, expect, it } from 'bun:test'

import { EReturnResult } from '@dltech/atlas-core'
import { EMcpOauthGrantStatus, EMcpServerSource, type McpOauthServer } from '@dltech/atlas-wire/web'

import { ELinkReturnKind } from '../../personal/link-return'
import {
  EMcpAuthState,
  authStateOf,
  cloudServerOf,
  lastUsedOf,
  mcpOauthScreenOf,
  mcpOauthServersInputOf,
  mcpResultMessageOf,
  mcpServerLabelOf,
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

describe('mcpServerLabelOf', () => {
  it('names the server by its host', () => {
    expect(mcpServerLabelOf(URL_A)).toBe('mcp.example.com')
  })

  it('falls back when the url cannot be read', () => {
    expect(mcpServerLabelOf('not a url')).toBe('the server')
  })
})

describe('mcpResultMessageOf', () => {
  it('announces a sign-in that connected', () => {
    expect(
      mcpResultMessageOf({
        label: 'mcp.example.com',
        outcome: { result: EReturnResult.Connected },
      }),
    ).toEqual({ kind: ELinkReturnKind.Success, message: 'Signed in to mcp.example.com' })
  })

  it('names the reason a sign-in failed', () => {
    expect(
      mcpResultMessageOf({
        label: 'mcp.example.com',
        outcome: { result: EReturnResult.Failed, reason: 'expired' },
      }),
    ).toEqual({
      kind: ELinkReturnKind.Error,
      message: "Couldn't sign in to mcp.example.com: expired",
    })
  })

  it('leaves out a blank reason', () => {
    expect(
      mcpResultMessageOf({ label: 'the server', outcome: { result: EReturnResult.Failed } }),
    ).toEqual({ kind: ELinkReturnKind.Error, message: "Couldn't sign in to the server" })
  })
})

describe('mcpOauthServersInputOf', () => {
  it('names the scope of the server list it asks for', () => {
    expect(mcpOauthServersInputOf({ kind: 'project', projectId: 'proj_1' })).toEqual({
      projectId: 'proj_1',
    })
    expect(mcpOauthServersInputOf({ kind: 'group', groupId: 'grp_1' })).toEqual({
      groupId: 'grp_1',
    })
    expect(mcpOauthServersInputOf({ kind: 'user' })).toEqual({})
  })
})

describe('mcpOauthScreenOf', () => {
  it('sends the sign-in back to the page that began it', () => {
    expect(mcpOauthScreenOf({ kind: 'user' })).toEqual({ kind: 'settings', scope: 'user' })
    expect(mcpOauthScreenOf({ kind: 'project', projectId: 'proj_1' })).toEqual({
      kind: 'settings',
      scope: 'project',
      id: 'proj_1',
    })
    expect(mcpOauthScreenOf({ kind: 'group', groupId: 'grp_1' })).toEqual({
      kind: 'settings',
      scope: 'group',
      id: 'grp_1',
    })
  })
})
