import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'bun:test'

import {
  getLocalThread,
  listLocalThreads,
  renameLocalThread,
  markLocalThreadRead,
} from '../local-thread-wire'
import { localSummary } from './local-thread-fixture'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())
const realFetch = globalThis.fetch
let status: number
let calls: { path: string; method: string; body: unknown }[]
beforeEach(() => {
  Reflect.set(window, 'atlasDesktop', {})
  status = 200
  calls = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({
        path: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (String(input).endsWith('/rename')) return new Response(null, { status: 204 })
      if (String(input).endsWith('/read')) return Response.json({ seq: 3 })
      return Response.json(
        status === 200 ? { threads: [localSummary] } : { message: 'Host unavailable' },
        { status },
      )
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
})

it('discovers projectless roots with authoritative head, dates and status', async () => {
  expect(await listLocalThreads()).toEqual([localSummary])
  expect(await getLocalThread('brn_1')).toEqual(localSummary)
  expect(calls.map((call) => call.path)).toEqual(['/desktop/threads', '/desktop/threads'])
})

it('distinguishes genuinely absent ids from unavailable and malformed hosts', async () => {
  expect(await getLocalThread('missing')).toBeNull()
  status = 503
  await expect(getLocalThread('brn_1')).rejects.toThrow('Host unavailable')
  status = 404
  await expect(listLocalThreads()).rejects.toThrow('Host unavailable')
  Reflect.deleteProperty(window, 'atlasDesktop')
  expect(await listLocalThreads()).toEqual([])
  expect(calls).toHaveLength(3)
})

it('renames with a 204 response and persists the local read cursor without wake', async () => {
  await renameLocalThread({ threadId: 'brn_1', title: 'User title' })
  expect(await markLocalThreadRead({ threadId: 'brn_1', seq: 3 })).toEqual({ seq: 3 })
  expect(calls).toEqual([
    { path: '/desktop/threads/brn_1/rename', method: 'POST', body: { title: 'User title' } },
    { path: '/desktop/threads/brn_1/read', method: 'POST', body: { seq: 3 } },
  ])
})
