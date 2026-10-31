import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'bun:test'

import {
  invalidateLocalThreadHistory,
  readLocalEvents,
  readLocalSeed,
} from '../local-thread-history'
import { localEvent } from './local-thread-fixture'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())
const realFetch = globalThis.fetch
let calls: string[]
let page: (after: number) => {
  events: ReturnType<typeof localEvent>[]
  head: number
  nextAfter: number | null
}
beforeEach(() => {
  calls = []
  invalidateLocalThreadHistory()
  Reflect.set(window, 'atlasDesktop', {})
  page = (after) =>
    after === 0
      ? { events: [], head: 3, nextAfter: 2 }
      : { events: [localEvent(3)], head: 3, nextAfter: null }
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const path = String(input)
      calls.push(path)
      return Response.json(
        page(Number(new URL(path, 'http://localhost').searchParams.get('after'))),
      )
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
  invalidateLocalThreadHistory()
})

it('follows sequence-range cursors across empty pages and includes the delta anchor', async () => {
  expect(await readLocalEvents({ threadId: 'brn_1' })).toEqual([localEvent(3)])
  expect(calls).toEqual([
    '/desktop/threads/brn_1/events?after=0&limit=500',
    '/desktop/threads/brn_1/events?after=2&limit=500',
  ])
  calls = []
  expect(await readLocalEvents({ threadId: 'brn_1', fromSeq: 3 })).toEqual([localEvent(3)])
  expect(calls).toEqual(['/desktop/threads/brn_1/events?after=2&limit=500'])
})

it('shares a full seed promise and cache between offline history and live attachment', async () => {
  const first = readLocalSeed('brn_1')
  const second = readLocalSeed('brn_1')
  expect(first).toBe(second)
  await Promise.all([first, second])
  expect(await readLocalSeed('brn_1')).toEqual([localEvent(3)])
  expect(calls).toHaveLength(2)
})

it('replaces cached suffix after an explicit reload or shrinking host head, including an empty delta', async () => {
  page = () => ({ events: [localEvent(1), localEvent(2), localEvent(3)], head: 3, nextAfter: null })
  await readLocalSeed('brn_1')
  page = (after) => ({ events: after === 0 ? [localEvent(1)] : [], head: 1, nextAfter: null })
  await readLocalEvents({ threadId: 'brn_1', fromSeq: 3 })
  expect(await readLocalSeed('brn_1')).toEqual([localEvent(1)])
  page = () => ({ events: [{ ...localEvent(1), id: 'rewritten' }], head: 1, nextAfter: null })
  invalidateLocalThreadHistory('brn_1')
  expect(await readLocalSeed('brn_1')).toEqual([{ ...localEvent(1), id: 'rewritten' }])
})

it('full reload replaces same-head rewritten events and updates the shared seed', async () => {
  page = () => ({ events: [localEvent(1)], head: 1, nextAfter: null })
  await readLocalSeed('brn_1')
  page = () => ({ events: [{ ...localEvent(1), id: 'replacement' }], head: 1, nextAfter: null })
  expect(await readLocalEvents({ threadId: 'brn_1' })).toEqual([
    { ...localEvent(1), id: 'replacement' },
  ])
  expect(await readLocalSeed('brn_1')).toEqual([{ ...localEvent(1), id: 'replacement' }])
  expect(calls).toHaveLength(2)
})

it('restarts paging if a rewind shrinks the host head midway through a full read', async () => {
  let count = 0
  page = (after) => {
    count += 1
    if (count === 1) return { events: [localEvent(1), localEvent(2)], head: 5, nextAfter: 2 }
    return {
      events: after === 0 ? [{ ...localEvent(1), id: 'rewound' }] : [],
      head: 1,
      nextAfter: null,
    }
  }
  expect(await readLocalEvents({ threadId: 'brn_1' })).toEqual([
    { ...localEvent(1), id: 'rewound' },
  ])
  expect(calls).toHaveLength(3)
})

it('rejects a nonadvancing cursor rather than looping on an empty page', async () => {
  page = () => ({ events: [], head: 3, nextAfter: 0 })
  await expect(readLocalEvents({ threadId: 'brn_1' })).rejects.toThrow('cursor')
  expect(calls).toHaveLength(1)
})
