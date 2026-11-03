import { describe, expect, it } from 'bun:test'

import { EAuthKind, toAccountId } from '@dltech/atlas-core'
import type { AgentHostModelAccessTokenOutput } from '@dltech/atlas-protocol'

import { AgentHostCredentialPort, CredentialsUnavailableError } from '../agent-host-credential-port'

type TokenCall = { sessionId: string; connectionId: string; rejectedAccessToken?: string }

const fakeApi = (answers: AgentHostModelAccessTokenOutput[]) => {
  const calls: TokenCall[] = []
  let index = 0
  return {
    calls,
    modelAccessToken: async (input: TokenCall): Promise<AgentHostModelAccessTokenOutput> => {
      calls.push(input)
      const answer = answers[Math.min(index, answers.length - 1)]
      index += 1
      if (answer === undefined) throw new Error('unexpected modelAccessToken call')
      return answer
    },
  }
}

const token = (accessToken: string, refreshAfter: string): AgentHostModelAccessTokenOutput => ({
  accessToken,
  expiresAt: refreshAfter,
  refreshAfter,
  generation: 1,
  authorizationId: 'auth-1',
})

const oauthModel = {
  configured: true as const,
  modelId: 'claude-haiku-4-5',
  accountId: 'acc-1',
  credential: { kind: 'oauth' as const, connectionId: 'conn-1' },
}

describe('AgentHostCredentialPort', () => {
  it('answers an api-key credential without calling the api', async () => {
    const api = fakeApi([])
    const port = new AgentHostCredentialPort({
      sessionId: 's1',
      model: {
        configured: true,
        modelId: 'claude-haiku-4-5',
        accountId: 'acc-key',
        credential: { kind: 'api-key', apiKey: 'sk-ant-x' },
      },
      api,
    })
    const credential = await port.read()
    expect(credential.kind).toBe(EAuthKind.ApiKey)
    expect(credential.accountId).toBe(toAccountId('acc-key'))
    if (credential.kind === EAuthKind.ApiKey) expect(credential.apiKey).toBe('sk-ant-x')
    expect(api.calls).toEqual([])
  })

  it('throws a typed error when the model is unconfigured', async () => {
    const port = new AgentHostCredentialPort({
      sessionId: 's1',
      model: { configured: false, gap: 'no anthropic account' },
      api: fakeApi([]),
    })
    await expect(port.read()).rejects.toBeInstanceOf(CredentialsUnavailableError)
    await expect(port.read()).rejects.toThrow('no anthropic account')
  })

  it('caches the oauth token until refreshAfter', async () => {
    let now = Date.parse('2026-11-03T12:00:00.000Z')
    const api = fakeApi([token('at-1', '2026-11-03T12:30:00.000Z')])
    const port = new AgentHostCredentialPort({
      sessionId: 's1',
      model: oauthModel,
      api,
      now: () => now,
    })
    const first = await port.read()
    const second = await port.read()
    expect(first.kind).toBe(EAuthKind.Oauth)
    expect(second.kind).toBe(EAuthKind.Oauth)
    if (first.kind === EAuthKind.Oauth) expect(first.accessToken).toBe('at-1')
    expect(api.calls).toEqual([{ sessionId: 's1', connectionId: 'conn-1' }])

    now = Date.parse('2026-11-03T12:31:00.000Z')
    api.calls.length = 0
    void (await port.read())
    expect(api.calls.length).toBe(1)
  })

  it('sends the rejected token once after discard', async () => {
    const now = Date.parse('2026-11-03T12:00:00.000Z')
    const api = fakeApi([
      token('at-1', '2026-11-03T12:30:00.000Z'),
      token('at-2', '2026-11-03T13:30:00.000Z'),
    ])
    const port = new AgentHostCredentialPort({
      sessionId: 's1',
      model: oauthModel,
      api,
      now: () => now,
    })
    const first = await port.read()
    await port.discard(first)
    const second = await port.read()
    if (second.kind === EAuthKind.Oauth) expect(second.accessToken).toBe('at-2')
    expect(api.calls).toEqual([
      { sessionId: 's1', connectionId: 'conn-1' },
      { sessionId: 's1', connectionId: 'conn-1', rejectedAccessToken: 'at-1' },
    ])

    const third = await port.read()
    if (third.kind === EAuthKind.Oauth) expect(third.accessToken).toBe('at-2')
    expect(api.calls.length).toBe(2)
    void now
  })
})
