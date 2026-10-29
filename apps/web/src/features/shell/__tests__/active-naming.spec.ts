import { describe, expect, it } from 'bun:test'

import { createActiveNaming } from '../active-naming'

describe('active naming store', () => {
  it('reads nothing for a thread that was never published', () => {
    const store = createActiveNaming()
    expect(store.read('thr_1')).toBeNull()
  })

  it('hands the published state to the matching thread only', () => {
    const store = createActiveNaming()
    store.publish({ threadId: 'thr_1', title: null, naming: true })
    expect(store.read('thr_1')).toEqual({ title: null, naming: true })
    expect(store.read('thr_2')).toBeNull()
  })

  it('notifies subscribers on change and not on an identical publish', () => {
    const store = createActiveNaming()
    let calls = 0
    store.subscribe(() => void (calls += 1))
    store.publish({ threadId: 'thr_1', title: null, naming: true })
    store.publish({ threadId: 'thr_1', title: null, naming: true })
    store.publish({ threadId: 'thr_1', title: 'Named', naming: false })
    expect(calls).toBe(2)
  })

  it('clears only the thread that published, and stops notifying after unsubscribe', () => {
    const store = createActiveNaming()
    let calls = 0
    const off = store.subscribe(() => void (calls += 1))
    store.publish({ threadId: 'thr_1', title: 'A', naming: false })
    store.clear('thr_2')
    expect(store.read('thr_1')).toEqual({ title: 'A', naming: false })
    store.clear('thr_1')
    expect(store.read('thr_1')).toBeNull()
    off()
    store.publish({ threadId: 'thr_3', title: 'B', naming: false })
    expect(calls).toBe(2)
  })
})
