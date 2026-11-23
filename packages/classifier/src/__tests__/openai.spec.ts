import { EClassifierFault, type ClassifierQuestion } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { OpenAiClassifier } from '../openai'

const DANGER: ClassifierQuestion = { type: 'noul', instructions: 'Is this risky?' }

type Recorded = { url: string; init: RequestInit | undefined }

const recordingFetch = (
  respond: (request: Recorded) => Response | Promise<Response>,
): { calls: Recorded[]; fetch: typeof fetch } => {
  const calls: Recorded[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = { url: String(input), init }
    calls.push(request)
    return await respond(request)
  }) as typeof fetch
  return { calls, fetch: fetchImpl }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const classifierOf = (fetchImpl: typeof fetch, timeoutMs?: number) =>
  new OpenAiClassifier({
    endpoint: 'https://api.openai.com/v1/decisions',
    model: 'gpt-6-luna',
    apiKey: 'sk-openai',
    fetch: fetchImpl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })

const ask = async (port: OpenAiClassifier, signal = new AbortController().signal) =>
  await port.classify({ state: 'the state', questions: { danger: DANGER }, signal })

describe('OpenAiClassifier', () => {
  it('posts the bearer key, the model, the input and the predicate question', async () => {
    const { calls, fetch: fetchImpl } = recordingFetch(() =>
      json({ answers: [{ type: 'predicate', name: 'danger', probability: 0.3 }] }),
    )

    const outcome = await ask(classifierOf(fetchImpl))

    expect(outcome).toEqual({
      ok: true,
      answers: { danger: { noul: 0.3 } },
      model: 'gpt-6-luna',
    })
    const [call] = calls
    expect(call?.url).toBe('https://api.openai.com/v1/decisions')
    const headers = call?.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-openai')
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      model: 'gpt-6-luna',
      input: 'the state',
      questions: [{ type: 'predicate', name: 'danger', instructions: 'Is this risky?' }],
    })
  })

  it('answers Rejected on a 401', async () => {
    const { fetch: fetchImpl } = recordingFetch(() => new Response('bad key', { status: 401 }))

    expect(await ask(classifierOf(fetchImpl))).toEqual({
      ok: false,
      fault: EClassifierFault.Rejected,
      detail: '401: bad key',
    })
  })

  it('answers Rejected when the model refuses a question', async () => {
    const { fetch: fetchImpl } = recordingFetch(() =>
      json({ answers: [{ type: 'refusal', name: 'danger' }] }),
    )

    expect(await ask(classifierOf(fetchImpl))).toMatchObject({
      ok: false,
      fault: EClassifierFault.Rejected,
    })
  })

  it('answers Malformed on a 200 whose body cannot be read', async () => {
    const { fetch: fetchImpl } = recordingFetch(() => new Response('not json', { status: 200 }))

    expect(await ask(classifierOf(fetchImpl))).toMatchObject({
      ok: false,
      fault: EClassifierFault.Malformed,
    })
  })

  it('answers Aborted when the caller aborts', async () => {
    const controller = new AbortController()
    const { fetch: fetchImpl } = recordingFetch(
      () =>
        new Promise<Response>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )

    const pending = ask(classifierOf(fetchImpl), controller.signal)
    controller.abort()

    expect(await pending).toMatchObject({ ok: false, fault: EClassifierFault.Aborted })
  })

  it('answers Aborted when the 10 000 ms deadline passes', async () => {
    const { fetch: fetchImpl } = recordingFetch(
      (request) =>
        new Promise<Response>((_, reject) => {
          request.init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )

    expect(await ask(classifierOf(fetchImpl, 5))).toMatchObject({
      ok: false,
      fault: EClassifierFault.Aborted,
    })
  })
})
