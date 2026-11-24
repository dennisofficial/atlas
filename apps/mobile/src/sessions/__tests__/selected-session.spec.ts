import { describe, expect, it } from 'bun:test'

import { failingJsonStore, memoryJsonStore } from '../../storage/json-store'
import { createSelectedSessionStore } from '../selected-session-store'

describe('createSelectedSessionStore', () => {
  it('starts with no selection', () => {
    const store = createSelectedSessionStore({ store: memoryJsonStore() })
    expect(store.current()).toBeNull()
  })

  it('remembers the selected session across a reload from disk', async () => {
    const disk = memoryJsonStore()
    const first = createSelectedSessionStore({ store: disk })
    first.select('ses_1')
    await Promise.resolve()
    const second = createSelectedSessionStore({ store: disk })
    expect(await second.load()).toBe('ses_1')
    expect(second.current()).toBe('ses_1')
  })

  it('clears the selection on disk when it is set to null', async () => {
    const disk = memoryJsonStore()
    const store = createSelectedSessionStore({ store: disk })
    store.select('ses_1')
    store.select(null)
    const reloaded = createSelectedSessionStore({ store: disk })
    expect(await reloaded.load()).toBeNull()
  })

  it('notifies subscribers on a change and stops after unsubscribe', () => {
    const store = createSelectedSessionStore({ store: memoryJsonStore() })
    let calls = 0
    const unsubscribe = store.subscribe(() => {
      calls += 1
    })
    store.select('ses_1')
    store.select('ses_1')
    expect(calls).toBe(1)
    unsubscribe()
    store.select('ses_2')
    expect(calls).toBe(1)
  })

  it('reports a load only once the disk has been read', async () => {
    const store = createSelectedSessionStore({ store: memoryJsonStore() })
    expect(store.loaded()).toBe(false)
    await store.load()
    expect(store.loaded()).toBe(true)
  })

  it('keeps a selection chosen before the disk answered', async () => {
    const disk = memoryJsonStore()
    await disk.write('selected-session', 'ses_old')
    const store = createSelectedSessionStore({ store: disk })
    store.select('ses_new')
    expect(await store.load()).toBe('ses_new')
    expect(store.current()).toBe('ses_new')
  })

  it('reads no selection from a store that cannot be read', async () => {
    const store = createSelectedSessionStore({ store: failingJsonStore() })
    expect(await store.load()).toBeNull()
  })

  it('keeps the in-memory selection when the write fails', () => {
    const store = createSelectedSessionStore({ store: failingJsonStore() })
    store.select('ses_1')
    expect(store.current()).toBe('ses_1')
  })
})
