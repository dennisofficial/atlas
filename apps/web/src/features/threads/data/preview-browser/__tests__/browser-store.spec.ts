import { describe, expect, it } from 'bun:test'

import {
  EViewportKind,
  NEW_TAB_URL,
  activeTabOf,
  currentUrlOf,
  navigated,
  openTab,
  updateTab,
} from '../browser-model'
import { parseBrowserState, storageKeyOf } from '../browser-persistence'
import { createBrowserStore } from '../browser-store'

class FakeStorage {
  items = new Map<string, string>()
  getItem = (key: string) => this.items.get(key) ?? null
  setItem = (key: string, value: string) => void this.items.set(key, value)
}

const URL_A = 'https://3000-abcdefghij.byatlas.dev/'

const storeOn = (storage: FakeStorage | undefined, clock = { value: 100 }) =>
  createBrowserStore({ storage, now: () => clock.value })

describe('browser-store', () => {
  it('seeds a fresh thread with one new tab stamped by the injected clock', () => {
    const state = storeOn(new FakeStorage()).read('t1')
    expect(state.tabs).toHaveLength(1)
    expect(currentUrlOf(activeTabOf(state)!)).toBe(NEW_TAB_URL)
    expect(state.tabs[0]?.lastUsedAt).toBe(100)
  })

  it('round-trips through storage and survives a new store', () => {
    const storage = new FakeStorage()
    const store = storeOn(storage)
    store.update({
      threadId: 't1',
      change: ({ state, now }) => {
        const opened = openTab({ state, url: URL_A, now })
        return updateTab({
          state: opened,
          id: opened.activeId!,
          change: (tab) => ({
            ...navigated({ tab, url: `${URL_A}x` }),
            viewport: { kind: EViewportKind.Fixed, width: 390, height: 844 },
          }),
        })
      },
    })
    expect(storage.items.has(storageKeyOf('t1'))).toBe(true)
    expect(storageKeyOf('t1')).toBe('atlas.preview-browser.v1.t1')
    const reloaded = storeOn(storage, { value: 999 }).read('t1')
    expect(reloaded).toEqual(store.read('t1'))
    expect(reloaded.tabs).toHaveLength(2)
    expect(activeTabOf(reloaded)?.viewport).toEqual({
      kind: EViewportKind.Fixed,
      width: 390,
      height: 844,
    })
  })

  it('isolates threads', () => {
    const storage = new FakeStorage()
    const store = storeOn(storage)
    store.update({ threadId: 't1', change: ({ state, now }) => openTab({ state, now }) })
    expect(store.read('t1').tabs).toHaveLength(2)
    expect(store.read('t2').tabs).toHaveLength(1)
    expect(Object.keys(store.readAll()).sort()).toEqual(['t1', 't2'])
  })

  it('notifies subscribers only on real changes and stops after unsubscribe', () => {
    const store = storeOn(new FakeStorage())
    let calls = 0
    const stop = store.subscribe(() => {
      calls += 1
    })
    store.update({ threadId: 't1', change: ({ state }) => state })
    expect(calls).toBe(0)
    store.update({ threadId: 't1', change: ({ state, now }) => openTab({ state, now }) })
    expect(calls).toBe(1)
    stop()
    store.update({ threadId: 't1', change: ({ state, now }) => openTab({ state, now }) })
    expect(calls).toBe(1)
  })

  it('changes snapshot identity of readAll on update', () => {
    const store = storeOn(new FakeStorage())
    store.read('t1')
    const before = store.readAll()
    expect(store.readAll()).toBe(before)
    store.update({ threadId: 't1', change: ({ state, now }) => openTab({ state, now }) })
    expect(store.readAll()).not.toBe(before)
  })

  it('falls back to fresh state on corrupt or invalid json', () => {
    const storage = new FakeStorage()
    storage.setItem(storageKeyOf('t1'), '{nope')
    storage.setItem(storageKeyOf('t2'), JSON.stringify({ tabs: 'x' }))
    storage.setItem(
      storageKeyOf('t3'),
      JSON.stringify({
        tabs: [
          {
            id: 'a',
            history: ['x'],
            index: 5,
            viewport: { kind: 'full' },
            lastUsedAt: 1,
          },
        ],
        activeId: 'a',
        nextId: 2,
      }),
    )
    const store = storeOn(storage)
    for (const threadId of ['t1', 't2', 't3']) {
      const state = store.read(threadId)
      expect(state.tabs).toHaveLength(1)
      expect(currentUrlOf(state.tabs[0]!)).toBe(NEW_TAB_URL)
    }
  })

  it('rejects an activeId that names no tab', () => {
    const raw = JSON.stringify({
      tabs: [{ id: 'a', history: ['x'], index: 0, viewport: { kind: 'full' }, lastUsedAt: 1 }],
      activeId: 'zzz',
      nextId: 2,
    })
    expect(parseBrowserState({ raw, now: 7 }).tabs[0]?.id).toBe('tab-1')
  })

  it('accepts a valid stored state with no active tab', () => {
    const raw = JSON.stringify({ tabs: [], nextId: 4 })
    expect(parseBrowserState({ raw, now: 7 })).toEqual({ tabs: [], nextId: 4 })
  })

  it('works without storage and when storage throws', () => {
    const store = storeOn(undefined)
    store.update({ threadId: 't1', change: ({ state, now }) => openTab({ state, now }) })
    expect(store.read('t1').tabs).toHaveLength(2)
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    const guarded = createBrowserStore({ storage: throwing, now: () => 1 })
    guarded.update({ threadId: 't1', change: ({ state, now }) => openTab({ state, now }) })
    expect(guarded.read('t1').tabs).toHaveLength(2)
  })
})
