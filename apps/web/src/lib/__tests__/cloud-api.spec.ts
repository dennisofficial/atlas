import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { cloudJson, cloudSend, EHttpMethod } from '../cloud-api'

type Seen = { url: string; init: RequestInit | undefined }

let fetchCalls: Seen[]
const realFetch = globalThis.fetch

const answerWith = (response: Response): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init })
    return response
  }) as typeof fetch
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  fetchCalls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('cloud requests', () => {
  it('bounds a GET with an abort signal', async () => {
    answerWith(json({ ok: true }))

    const body = await cloudJson({
      method: EHttpMethod.Get,
      path: '/v1/cloud/settings',
      schema: z.object({ ok: z.boolean() }),
    })

    expect(body).toEqual({ ok: true })
    expect(fetchCalls[0]?.init?.method).toBe('GET')
    expect(fetchCalls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends no abort signal on a POST, so a slow write is never aborted', async () => {
    answerWith(json({ ok: true }))

    await cloudSend({ method: EHttpMethod.Post, path: '/v1/cloud/settings', body: { ok: true } })

    expect(fetchCalls[0]?.init?.method).toBe('POST')
    expect(fetchCalls[0]?.init?.signal ?? null).toBeNull()
  })
})
