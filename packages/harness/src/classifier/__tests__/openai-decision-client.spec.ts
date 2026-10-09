import { jevRiskQuestions } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { OpenAiDecisionClient } from '../openai-decision-client'

const CONFIG = { url: 'https://openai.example/v1/decisions', token: 'sk-test', model: 'gpt-6-luna' }

const clientOver = (respond: () => Promise<Response>, timeoutMs?: number) =>
  new OpenAiDecisionClient({
    config: () => CONFIG,
    fetch: (async () => respond()) as unknown as typeof fetch,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })

const ask = (client: OpenAiDecisionClient, signal: AbortSignal = AbortSignal.timeout(5000)) =>
  client.decide({ state: 's', questions: jevRiskQuestions(), signal })

describe('OpenAiDecisionClient', () => {
  it('is not configured when there is no config', async () => {
    const outcome = await ask(new OpenAiDecisionClient({ config: () => undefined }))
    expect(outcome.ok).toBe(false)
  })

  it('echoes the model the API reports and skips refusals', async () => {
    const outcome = await ask(
      clientOver(async () =>
        Response.json({
          model: 'gpt-6-luna-2026',
          answers: [
            { type: 'predicate', name: 'danger', probability: 0.9 },
            { type: 'refusal', name: 'other' },
          ],
        }),
      ),
    )
    expect(outcome).toEqual({ ok: true, answers: { danger: { noul: 0.9 } }, model: 'gpt-6-luna-2026' })
  })

  it('reports a non-200 as a fault carrying the status', async () => {
    const outcome = await ask(clientOver(async () => new Response('nope', { status: 401 })))
    expect(outcome).toEqual({ ok: false, fault: 'openai decisions answered 401: nope' })
  })

  it('faults on an unreadable shape', async () => {
    const outcome = await ask(clientOver(async () => Response.json({ answers: 'x' })))
    expect(outcome.ok).toBe(false)
  })

  it('faults when the caller aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = new OpenAiDecisionClient({
      config: () => CONFIG,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted === true) reject(new Error('aborted'))
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })) as unknown as typeof fetch,
    })
    const outcome = await ask(client, controller.signal)
    expect(outcome).toEqual({ ok: false, fault: 'aborted' })
  })

  it('faults on timeout', async () => {
    const client = new OpenAiDecisionClient({
      config: () => CONFIG,
      timeoutMs: 10,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('timed out')))
        })) as unknown as typeof fetch,
    })
    expect((await ask(client)).ok).toBe(false)
  })
})
