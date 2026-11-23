import { EClassifierFault, type ClassifierQuestion } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { classifierBaseUrl, JevClassifier } from '../jev'

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
  new JevClassifier({
    endpoint: 'https://api.typesafe.ai',
    model: 'jev-latest',
    apiKey: 'sk-jev',
    fetch: fetchImpl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })

const ask = async (port: JevClassifier, signal = new AbortController().signal) =>
  await port.classify({ state: 'the state', questions: { danger: DANGER }, signal })

describe('classifierBaseUrl', () => {
  it('strips trailing slashes and a doubled /v1/systemone', () => {
    expect(classifierBaseUrl('https://api.typesafe.ai/')).toBe('https://api.typesafe.ai')
    expect(classifierBaseUrl('https://api.typesafe.ai/v1/systemone')).toBe(
      'https://api.typesafe.ai',
    )
    expect(classifierBaseUrl('https://api.typesafe.ai/v1/systemone/')).toBe(
      'https://api.typesafe.ai',
    )
  })
})

describe('JevClassifier', () => {
  it('posts the bearer key, the table model and the questions to /v1/systemone', async () => {
    const { calls, fetch: fetchImpl } = recordingFetch(() =>
      json({ answers: { danger: { noul: 0.2 } } }),
    )

    const outcome = await ask(classifierOf(fetchImpl))

    expect(outcome).toEqual({
      ok: true,
      answers: { danger: { noul: 0.2 } },
      model: 'jev-latest',
    })
    const [call] = calls
    expect(call?.url).toBe('https://api.typesafe.ai/v1/systemone')
    const headers = call?.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-jev')
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      model: 'jev-latest',
      state: 'the state',
      questions: { danger: { type: 'noul', instructions: 'Is this risky?' } },
    })
  })

  it('strips a doubled /v1/systemone from the endpoint', async () => {
    const { calls, fetch: fetchImpl } = recordingFetch(() =>
      json({ answers: { danger: { noul: 0.2 } } }),
    )

    await new JevClassifier({
      endpoint: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
      model: 'typesafe-ai/jev',
      apiKey: 'gw',
      fetch: fetchImpl,
    }).classify({
      state: 's',
      questions: { danger: DANGER },
      signal: new AbortController().signal,
    })

    expect(calls[0]?.url).toBe('https://ai-gateway.vercel.sh/typesafe/v1/systemone')
  })

  it('answers Rejected with the status and the body on a 429', async () => {
    const { fetch: fetchImpl } = recordingFetch(() => new Response('slow down', { status: 429 }))

    expect(await ask(classifierOf(fetchImpl))).toEqual({
      ok: false,
      fault: EClassifierFault.Rejected,
      detail: '429: slow down',
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

  it('answers Aborted when the 2000 ms deadline passes', async () => {
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
