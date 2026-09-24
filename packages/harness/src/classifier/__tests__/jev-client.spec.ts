import { describe, expect, it } from 'bun:test'
import { jevRiskQuestions } from '@dltech/atlas-core'

import { JevDecisionClient, type JevSystemOne } from '../jev-client'

const CONFIG = { baseUrl: 'https://decisions.example', token: 'sk-test' }

const noulResult = (noul: number) => ({
  model: 'jev-latest',
  answers: { danger: { type: 'noul', noul } },
  usage: { input_tokens: 100, output_tokens: 0 },
})

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

  it('asks through the SDK client with the configured model and the caller signal', async () => {
    let seen: { request: unknown; options: unknown } | undefined
    const systemOne: JevSystemOne = async (request, options) => {
      seen = { request, options }
      return noulResult(0.1)
    }
    const client = new JevDecisionClient({ config: () => CONFIG, systemOne })

    const outcome = await decide(client)

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.answers['danger']?.noul).toBe(0.1)
    const request = seen?.request as { model: string; state: string; questions: Record<string, { type: string }> }
    expect(request.model).toBe('jev-latest')
    expect(request.state).toBe('the call about to run')
    expect(request.questions['danger']?.type).toBe('noul')
    expect((seen?.options as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal)
  })

  it('fails closed-shape when the SDK rejects (a non-2xx after retries)', async () => {
    const systemOne: JevSystemOne = async () => {
      throw new Error('the decision model answered 401')
    }
    const client = new JevDecisionClient({ config: () => CONFIG, systemOne })

    const outcome = await decide(client)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.fault).toContain('401')
  })

  it('fails on an unreadable answer shape', async () => {
    const systemOne: JevSystemOne = async () => ({ nope: 1 })
    const client = new JevDecisionClient({ config: () => CONFIG, systemOne })

    const outcome = await decide(client)

    expect(outcome.ok).toBe(false)
  })

  it('fails when the call outlasts the caller signal', async () => {
    const systemOne: JevSystemOne = (_request, options) =>
      new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const client = new JevDecisionClient({ config: () => CONFIG, systemOne })

    const outcome = await client.decide({
      state: 'x',
      questions: jevRiskQuestions(),
      signal: AbortSignal.timeout(20),
    })

    expect(outcome.ok).toBe(false)
  })
})
