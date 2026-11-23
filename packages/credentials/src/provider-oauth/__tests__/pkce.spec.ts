import { createHash } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { anthropicManualAuthorizeUrl, anthropicPkce, decodeJwtClaims } from '..'

describe('provider-oauth', () => {
  it('derives the S256 challenge with web crypto exactly as node does', async () => {
    const pkce = await anthropicPkce()
    expect(pkce.challenge).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'))
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pkce.state).not.toBe(pkce.verifier)
  })

  it('asks Anthropic for the paste-back code page', async () => {
    const url = new URL(anthropicManualAuthorizeUrl(await anthropicPkce()))
    expect(url.origin + url.pathname).toBe('https://claude.com/cai/oauth/authorize')
    expect(url.searchParams.get('code')).toBe('true')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://platform.claude.com/oauth/code/callback',
    )
  })

  it('decodes unicode JWT claims without Buffer', () => {
    const payload = Buffer.from(JSON.stringify({ email: 'zoë@example.com' })).toString('base64url')
    expect(decodeJwtClaims(`h.${payload}.s`)?.email).toBe('zoë@example.com')
  })
})
