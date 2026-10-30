import { describe, expect, it } from 'bun:test'

import { EMcpOauthGrantStatus } from '@dltech/atlas-wire/web'

import { ELinkReturnKind } from '../../personal/link-return'
import {
  EMcpAuthState,
  authStateOf,
  mcpOauthReturnOf,
  signInUrlOf,
  statusUrlsOf,
} from '../mcp-oauth'

const URL_A = 'https://mcp.example.com/mcp'

describe('signInUrlOf', () => {
  it('offers sign-in for a plain http server', () => {
    expect(signInUrlOf({ url: URL_A, headers: undefined })).toBe(URL_A)
  })

  it('offers none when an Authorization header is configured, any casing', () => {
    expect(signInUrlOf({ url: URL_A, headers: { authorization: 'Bearer x' } })).toBeUndefined()
    expect(signInUrlOf({ url: URL_A, headers: { Authorization: 'Bearer x' } })).toBeUndefined()
  })

  it('keeps sign-in when only unrelated headers are set', () => {
    expect(signInUrlOf({ url: URL_A, headers: { 'X-Team': 'a' } })).toBe(URL_A)
  })
})

describe('statusUrlsOf', () => {
  it('queries only enabled, sign-in-capable servers, deduplicated', () => {
    expect(
      statusUrlsOf([
        { id: 'a', enabled: true, signInUrl: URL_A },
        { id: 'b', enabled: true, signInUrl: URL_A },
        { id: 'c', enabled: false, signInUrl: 'https://off.example.com' },
        { id: 'd', enabled: true },
        { id: 'e', enabled: true, signInUrl: 'not a url' },
      ]),
    ).toEqual([URL_A])
  })
})

describe('authStateOf', () => {
  const grant = (status: EMcpOauthGrantStatus) => [{ serverUrl: URL_A, status }]

  it('maps grant statuses to row states', () => {
    expect(authStateOf({ signInUrl: URL_A, grants: grant(EMcpOauthGrantStatus.Connected) })).toBe(
      EMcpAuthState.SignedIn,
    )
    expect(authStateOf({ signInUrl: URL_A, grants: grant(EMcpOauthGrantStatus.Expired) })).toBe(
      EMcpAuthState.SignInAgain,
    )
    expect(authStateOf({ signInUrl: URL_A, grants: grant(EMcpOauthGrantStatus.None) })).toBe(
      EMcpAuthState.SignIn,
    )
  })

  it('shows nothing before status arrives or without a sign-in url', () => {
    expect(authStateOf({ signInUrl: URL_A, grants: [] })).toBeUndefined()
    expect(
      authStateOf({ signInUrl: undefined, grants: grant(EMcpOauthGrantStatus.Connected) }),
    ).toBeUndefined()
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
