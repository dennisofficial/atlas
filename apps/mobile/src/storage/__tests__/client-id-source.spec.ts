import { describe, expect, it } from 'bun:test'

import { createClientIdSource } from '../client-id-source'
import { failingJsonStore, type JsonStore, memoryJsonStore } from '../json-store'

const countingStore = (store: JsonStore): JsonStore & { reads: () => number } => {
  let reads = 0
  return {
    ...store,
    reads: () => reads,
    read: (name) => {
      reads += 1
      return store.read(name)
    },
  }
}

describe('createClientIdSource', () => {
  it('opens the store once for concurrent callers and gives them one id', async () => {
    const store = countingStore(memoryJsonStore())
    let minted = 0
    const clientId = createClientIdSource({
      store: () => store,
      newId: () => `id-${++minted}`,
    })
    const ids = await Promise.all([clientId(), clientId(), clientId()])
    expect(ids).toEqual(['id-1', 'id-1', 'id-1'])
    expect(store.reads()).toBe(1)
    expect(await store.read('clientId')).toBe('id-1')
  })

  it('keeps the stored id of an earlier launch', async () => {
    const store = memoryJsonStore()
    await store.write('clientId', 'stored-id')
    const clientId = createClientIdSource({ store: () => store, newId: () => 'new-id' })
    expect(await clientId()).toBe('stored-id')
  })

  it('tries again after a failed read', async () => {
    const healthy = memoryJsonStore()
    let current: JsonStore = failingJsonStore()
    const clientId = createClientIdSource({ store: () => current, newId: () => 'id-1' })
    await expect(clientId()).rejects.toThrow('the store is unavailable')
    current = healthy
    expect(await clientId()).toBe('id-1')
  })
})
