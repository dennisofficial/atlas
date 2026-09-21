import { describe, expect, it } from 'bun:test'

import { jevRiskQuestions } from '@dltech/atlas-core'

import { JevDecisionClient, type JevFetcher } from '../jev-client'

const answering = (body: unknown, status = 200): JevFetcher => async () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const noulBody = (noul: number) => ({
  model: 'laya',
  answers: { danger: { type: 'noul', noul, rl_agent: { act_probability: 1 } } },
  usage: { input_tokens: 100, output_tokens: 0 },
})

const CONFIG = { baseUrl: 'https://decisions.example/v1', token: 'sk-test' }

const decide = (client: JevDecisionClient) =>
  client.decide({
    state: 'the call about to run',
    questions: jevRiskQuestions(),
    signal: AbortSignal.timeout(5000),
  })

describe('JevDecisionClient', () => {
  it('is not configured when decisions.url is empty', async () => {
    const client = new JevDecisionClient({ config: () => undefined })
    const outcome = await decide(client)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.fault).toContain('not set')
  })

  it('posts the jev wire shape with the bearer token', async () => {
    let seen: { url: unknown; init: RequestInit | undefined } | undefined
    const fetcher: JevFetcher = async (url, init) => {
      seen = { url, init }
      return new Response(JSON.stringify(noulBody(0.1)))
    }
    const client = new JevDecisionClient({ config: () => CONFIG, fetcher })

    const outcome = await decide(client)

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.answers['danger']?.noul).toBe(0.1)
    expect(seen?.url).toBe(CONFIG.baseUrl)
    const headers = seen?.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')
    const body = JSON.parse(String(seen?.init?.body))
    expect(body.model).toBe('jev-latest')
    expect(body.state).toBe('the call about to run')
    expect(body.questions.danger.type).toBe('noul')
  })

  it('omits the authorization header without a token', async () => {
    let seen: RequestInit | undefined
    const fetcher: JevFetcher = async (_url, init) => {
      seen = init
      return new Response(JSON.stringify(noulBody(0.1)))
    }
    const client = new JevDecisionClient({
      config: () => ({ baseUrl: 'http://localhost:8080', token: undefined }),
      fetcher,
    })

    await decide(client)

    expect((seen?.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('fails closed-shape on a non-200', async () => {
    const client = new JevDecisionClient({ config: () => CONFIG, fetcher: answering({}, 401) })
    const outcome = await decide(client)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.fault).toContain('401')
  })

  it('fails on an unreadable body', async () => {
    const client = new JevDecisionClient({ config: () => CONFIG, fetcher: answering({ nope: 1 }) })
    const outcome = await decide(client)
    expect(outcome.ok).toBe(false)
  })

  it('fails when the fetch throws', async () => {
    const fetcher: JevFetcher = async () => {
      throw new Error('socket hangup')
    }
    const client = new JevDecisionClient({ config: () => CONFIG, fetcher })
    const outcome = await decide(client)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.fault).toContain('socket hangup')
  })

  it('fails when the answer outlasts the timeout', async () => {
    const fetcher: JevFetcher = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const client = new JevDecisionClient({ config: () => CONFIG, fetcher, timeoutMs: 20 })

    const outcome = await decide(client)
    expect(outcome.ok).toBe(false)
  })
})
