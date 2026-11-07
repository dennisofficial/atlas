import { describe, expect, it } from 'bun:test'

import { EAuthKind, EEffort, toAccountId } from '@dltech/atlas-core'
import type { IssuedModelToken } from '../../tokens/oauth-types'

import { AgentHostCredentialPort, CredentialsUnavailableError } from '../agent-host-credential-port'

type TokenCall = { userId: string; connectionId: string; rejectedAccessToken?: string }

const fakeTokens = (answers: IssuedModelToken[]) => {
  const calls: TokenCall[] = []
  let index = 0
  return {
    calls,
    issue: async (input: TokenCall): Promise<IssuedModelToken> => {
      calls.push(input)
      const answer = answers[Math.min(index, answers.length - 1)]
      index += 1
      if (answer === undefined) throw new Error('unexpected issue call')
      return answer
    },
  }
}

const token = (accessToken: string, refreshAfter: string): IssuedModelToken => ({
  accessToken,
  expiresAt: refreshAfter,
  refreshAfter,
  generation: 1,
})

const oauthModel = {
  configured: true as const,
  ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
  effort: EEffort.Medium,
  fast: false,
  accountId: 'acc-1',
  credential: { kind: 'oauth' as const, connectionId: 'conn-1' },
}

describe('AgentHostCredentialPort', () => {
  it('answers an api-key credential without issuing a token', async () => {
    const tokens = fakeTokens([])
    const port = new AgentHostCredentialPort({
      userId: 'u1',
      model: {
        configured: true,
        ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
        effort: EEffort.Medium,
        fast: false,
        accountId: 'acc-key',
        credential: { kind: 'api-key', apiKey: 'sk-ant-x' },
      },
      tokens,
    })
    const credential = await port.read()
    expect(credential.kind).toBe(EAuthKind.ApiKey)
    expect(credential.accountId).toBe(toAccountId('acc-key'))
    if (credential.kind === EAuthKind.ApiKey) expect(credential.apiKey).toBe('sk-ant-x')
    expect(tokens.calls).toEqual([])
  })

  it('throws a typed error when the model is unconfigured', async () => {
    const port = new AgentHostCredentialPort({
      userId: 'u1',
      model: { configured: false, gap: 'no anthropic account' },
      tokens: fakeTokens([]),
    })
    await expect(port.read()).rejects.toBeInstanceOf(CredentialsUnavailableError)
    await expect(port.read()).rejects.toThrow('no anthropic account')
  })

  it('caches the oauth token until refreshAfter', async () => {
    let now = Date.parse('2026-11-03T12:00:00.000Z')
    const tokens = fakeTokens([token('at-1', '2026-11-03T12:30:00.000Z')])
    const port = new AgentHostCredentialPort({
      userId: 'u1',
      model: oauthModel,
      tokens,
      now: () => now,
    })
    const first = await port.read()
    const second = await port.read()
    expect(first.kind).toBe(EAuthKind.Oauth)
    expect(second.kind).toBe(EAuthKind.Oauth)
    if (first.kind === EAuthKind.Oauth) expect(first.accessToken).toBe('at-1')
    expect(tokens.calls).toEqual([{ userId: 'u1', connectionId: 'conn-1' }])

    now = Date.parse('2026-11-03T12:31:00.000Z')
    tokens.calls.length = 0
    void (await port.read())
    expect(tokens.calls.length).toBe(1)
  })

  it('sends the rejected token once after discard', async () => {
    const now = Date.parse('2026-11-03T12:00:00.000Z')
    const tokens = fakeTokens([
      token('at-1', '2026-11-03T12:30:00.000Z'),
      token('at-2', '2026-11-03T13:30:00.000Z'),
    ])
    const port = new AgentHostCredentialPort({
      userId: 'u1',
      model: oauthModel,
      tokens,
      now: () => now,
    })
    const first = await port.read()
    await port.discard(first)
    const second = await port.read()
    if (second.kind === EAuthKind.Oauth) expect(second.accessToken).toBe('at-2')
    expect(tokens.calls).toEqual([
      { userId: 'u1', connectionId: 'conn-1' },
      { userId: 'u1', connectionId: 'conn-1', rejectedAccessToken: 'at-1' },
    ])

    const third = await port.read()
    if (third.kind === EAuthKind.Oauth) expect(third.accessToken).toBe('at-2')
    expect(tokens.calls.length).toBe(2)
    void now
  })

  it('carries the provider account id of an issued token onto the credential', async () => {
    const tokens = fakeTokens([
      { ...token('at-1', '2026-11-03T12:30:00.000Z'), providerAccountId: 'cg-1' },
    ])
    const port = new AgentHostCredentialPort({
      userId: 'u1',
      model: oauthModel,
      tokens,
      now: () => Date.parse('2026-11-03T12:00:00.000Z'),
    })
    const credential = await port.read()
    if (credential.kind === EAuthKind.Oauth) expect(credential.providerAccountId).toBe('cg-1')
    const cached = await port.read()
    if (cached.kind === EAuthKind.Oauth) expect(cached.providerAccountId).toBe('cg-1')
  })
})
