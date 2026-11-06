import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  createThreadMemory,
  MAX_REMEMBERED_THREADS,
  parseThreadMemories,
  withThreadMemory,
} from '../thread-memory'

const schema = z.record(z.string(), z.number())

function fakeStorage() {
  const items = new Map<string, string>()
  return {
    items,
    storage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    },
  }
}

describe('parseThreadMemories', () => {
  it('reads stored memories', () => {
    const raw = JSON.stringify({ a: { transcript: 60, 'right-panel': 40 } })
    expect(parseThreadMemories({ raw, schema })).toEqual({
      a: { transcript: 60, 'right-panel': 40 },
    })
  })

  it('falls back to nothing for missing or malformed storage', () => {
    expect(parseThreadMemories({ raw: null, schema })).toEqual({})
    expect(parseThreadMemories({ raw: '{not json', schema })).toEqual({})
    expect(parseThreadMemories({ raw: '[1]', schema })).toEqual({})
  })

  it('drops only the thread whose entry no longer fits the schema', () => {
    const raw = JSON.stringify({
      a: { transcript: 'wide' },
      b: { transcript: 50 },
    })
    expect(parseThreadMemories({ raw, schema })).toEqual({
      b: { transcript: 50 },
    })
  })
})

describe('withThreadMemory', () => {
  it('replaces a thread memory and moves it to the newest slot', () => {
    const next = withThreadMemory({
      memories: { a: { transcript: 50 }, b: { transcript: 60 } },
      threadId: 'a',
      memory: { transcript: 70 },
    })
    expect(Object.keys(next)).toEqual(['b', 'a'])
    expect(next.a).toEqual({ transcript: 70 })
  })

  it('forgets the least recently touched threads past the cap', () => {
    const memories = Object.fromEntries(
      Array.from({ length: MAX_REMEMBERED_THREADS }, (_, index) => [
        `t${index}`,
        { transcript: 50 },
      ]),
    )
    const next = withThreadMemory({
      memories,
      threadId: 'fresh',
      memory: { transcript: 30 },
    })
    expect(Object.keys(next)).toHaveLength(MAX_REMEMBERED_THREADS)
    expect(next.t0).toBeUndefined()
    expect(next.fresh).toEqual({ transcript: 30 })
  })
})

describe('createThreadMemory', () => {
  it('survives a fresh memory over the same storage, as after a reload', () => {
    const { storage } = fakeStorage()
    createThreadMemory({ key: 'k', schema, storage: () => storage }).remember({
      threadId: 'a',
      memory: { transcript: 70 },
    })
    const reloaded = createThreadMemory({
      key: 'k',
      schema,
      storage: () => storage,
    })
    expect(reloaded.recall('a')).toEqual({ transcript: 70 })
    expect(reloaded.recall('b')).toBeUndefined()
  })

  it('keeps working when storage is unavailable or throws', () => {
    const missing = createThreadMemory({
      key: 'k',
      schema,
      storage: () => undefined,
    })
    missing.remember({ threadId: 'a', memory: { transcript: 1 } })
    expect(missing.recall('a')).toBeUndefined()
    const throwing = createThreadMemory({
      key: 'k',
      schema,
      storage: () => ({
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('quota')
        },
      }),
    })
    throwing.remember({ threadId: 'a', memory: { transcript: 1 } })
    expect(throwing.recall('a')).toBeUndefined()
  })
})
