import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import * as realApiClient from '@/lib/api-client'

let calls: { url: string; init?: RequestInit }[]
let data: unknown

const fakeFetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return Response.json({ result: { data } })
  },
  { preconnect: fetch.preconnect },
)

mock.module('@/lib/api-client', () => ({
  ...realApiClient,
  api: createApiClient({ baseUrl: '', fetchFn: fakeFetch }),
}))

const { fetchInstructions, saveInstructions } = await import('../instructions-api')

const answerWith = (next: unknown): void => {
  data = next
}

beforeEach(() => {
  calls = []
})

describe('instructions api', () => {
  it('reads the instructions file through userFiles.get', async () => {
    answerWith({
      files: [
        {
          path: '.atlas/ATLAS.md',
          revision: 2,
          contentHash: 'h',
          tombstonedAt: null,
          content: 'aGVsbG8=',
        },
      ],
    })
    expect(await fetchInstructions()).toEqual({ text: 'hello', revision: 2 })
    expect(calls[0]?.url).toBe('/v1/trpc/userFiles.get')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      tree: 'instructions',
      paths: ['.atlas/ATLAS.md'],
    })
  })

  it('saves through userFiles.put with the base revision', async () => {
    answerWith({ revision: 5 })
    expect(await saveInstructions({ text: 'hello', baseRevision: 4 })).toEqual({
      text: 'hello',
      revision: 5,
    })
    expect(calls[0]?.url).toBe('/v1/trpc/userFiles.put')
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      tree: 'instructions',
      path: '.atlas/ATLAS.md',
      content: 'aGVsbG8=',
      baseRevision: 4,
    })
  })
})
