import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { decodeSettingValue, encodeSettingValue } from '@dltech/atlas-wire/web'

import {
  fetchVercelProjectId,
  saveVercelProjectId,
  VERCEL_PROJECT_ID_KEY,
} from '../project-settings-api'

let calls: { url: string; init?: RequestInit }[]
const realFetch = globalThis.fetch

const answerWith = (response: Response): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return response
  }) as typeof fetch
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('fetchVercelProjectId', () => {
  it('reads and decodes the stored project id', async () => {
    answerWith(
      json({
        settings: [
          { key: 'other', value: 'x', updatedAt: '' },
          { key: VERCEL_PROJECT_ID_KEY, value: encodeSettingValue('prj_123'), updatedAt: '' },
        ],
      }),
    )
    expect(await fetchVercelProjectId('p 1')).toBe('prj_123')
    expect(calls[0]?.url).toBe('/v1/projects/p%201/settings')
  })

  it('answers an empty string when the key is unset', async () => {
    answerWith(json({ settings: [] }))
    expect(await fetchVercelProjectId('p1')).toBe('')
  })
})

describe('saveVercelProjectId', () => {
  const sentValues = (): Record<string, string | null> => {
    const body: unknown = JSON.parse(String(calls[0]?.init?.body))
    return (body as { values: Record<string, string | null> }).values
  }

  it('PATCHes the encoded, trimmed value', async () => {
    answerWith(new Response(null, { status: 204 }))
    await saveVercelProjectId({ projectId: 'p1', value: '  prj_9 ' })
    expect(calls[0]?.init?.method).toBe('PATCH')
    expect(calls[0]?.url).toBe('/v1/projects/p1/settings')
    const stored = sentValues()[VERCEL_PROJECT_ID_KEY]
    expect(stored).toBe(encodeSettingValue('prj_9'))
    expect(decodeSettingValue(stored ?? '')).toBe('prj_9')
  })

  it('clears the setting with null when the input is blank', async () => {
    answerWith(new Response(null, { status: 204 }))
    await saveVercelProjectId({ projectId: 'p1', value: '   ' })
    expect(sentValues()).toEqual({ [VERCEL_PROJECT_ID_KEY]: null })
  })
})
