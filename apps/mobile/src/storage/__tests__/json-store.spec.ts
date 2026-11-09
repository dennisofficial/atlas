import { describe, expect, test } from 'bun:test'

import { type JsonEntry, type JsonStore, serializedStore } from '../json-store'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const gatedJsonStore = () => {
  const calls: string[] = []
  const failures = new Set<string>()
  const files = new Map<string, unknown>()
  const waiting: Array<() => void> = []
  const hold = async (label: string): Promise<void> => {
    calls.push(label)
    await new Promise<void>((resolve) => waiting.push(resolve))
    if (failures.has(label)) throw new Error(label)
  }
  const store: JsonStore = {
    read: async (name) => {
      await hold(`read:${name}`)
      return files.get(name)
    },
    write: async (name, value) => {
      await hold(`write:${name}`)
      files.set(name, value)
    },
    remove: async (name) => {
      await hold(`remove:${name}`)
      files.delete(name)
    },
    list: async (): Promise<readonly JsonEntry[]> => {
      await hold('list')
      return [...files.keys()].map((name) => ({ name, modifiedAt: 0 }))
    },
    clear: async () => {
      await hold('clear')
      files.clear()
    },
  }
  const drain = async (): Promise<void> => {
    await flush()
    while (waiting.length > 0) {
      for (const release of waiting.splice(0)) release()
      await flush()
    }
  }
  return { store, calls, files, failures, drain }
}

const outcomeOf = (operation: Promise<unknown>): Promise<string> =>
  operation.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : 'unknown'),
  )

describe('serializedStore', () => {
  test('two concurrent writes to one name both resolve and the last written value wins', async () => {
    const harness = gatedJsonStore()
    const store = serializedStore(harness.store)

    const first = store.write('notes', 'first')
    const second = store.write('notes', 'second')
    await harness.drain()

    expect(await outcomeOf(first)).toBe('resolved')
    expect(await outcomeOf(second)).toBe('resolved')
    expect(harness.calls).toEqual(['write:notes', 'write:notes'])
    expect(harness.files.get('notes')).toBe('second')
  })

  test('a clear issued while a write is in flight runs after it', async () => {
    const harness = gatedJsonStore()
    const store = serializedStore(harness.store)

    const write = store.write('notes', 'value')
    const clear = store.clear()
    await flush()

    expect(harness.calls).toEqual(['write:notes'])

    await harness.drain()
    await write
    await clear

    expect(harness.calls).toEqual(['write:notes', 'clear'])
    expect(harness.files.has('notes')).toBe(false)
  })

  test('a rejected operation still rejects to its caller and the chain keeps going', async () => {
    const harness = gatedJsonStore()
    harness.failures.add('write:broken')
    const store = serializedStore(harness.store)

    const broken = outcomeOf(store.write('broken', 'value'))
    const following = store.write('fine', 'value')
    const read = store.read('fine')
    await harness.drain()

    expect(await broken).toBe('write:broken')
    expect(await outcomeOf(following)).toBe('resolved')
    expect(await read).toBe('value')
    expect(harness.calls).toEqual(['write:broken', 'write:fine', 'read:fine'])
  })

  test('write, remove and write run strictly in call order', async () => {
    const harness = gatedJsonStore()
    const store = serializedStore(harness.store)

    const operations = [
      store.write('notes', 'first'),
      store.remove('notes'),
      store.write('notes', 'second'),
    ]
    await harness.drain()
    await Promise.all(operations)

    expect(harness.calls).toEqual(['write:notes', 'remove:notes', 'write:notes'])
    expect(harness.files.get('notes')).toBe('second')
  })
})
