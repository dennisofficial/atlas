import { describe, expect, it } from 'bun:test'

import { watchPaneNavigations, watchPaneTitles } from '../pane-bridge'

type Call = { name: string; listener: (report: unknown) => void }

const hostWith = (names: readonly string[]) => {
  const calls: Call[] = []
  const held = new Map<string, Set<(report: unknown) => void>>()
  const bridge: Record<string, unknown> = {}
  const listenersOf = (name: string) => {
    const found = held.get(name)
    if (found !== undefined) return found
    const made = new Set<(report: unknown) => void>()
    held.set(name, made)
    return made
  }
  for (const name of names)
    bridge[name] = (listener: (report: unknown) => void) => {
      calls.push({ name, listener })
      const listening = name.startsWith('off') ? name.replace('off', 'on') : name
      const set = listenersOf(listening)
      if (name.startsWith('off')) set.delete(listener)
      else set.add(listener)
    }
  const emit = (name: string, report: unknown) => {
    for (const listener of [...listenersOf(name)]) listener(report)
  }
  return { host: { atlasDesktop: bridge }, emit, calls }
}

const EVERY_NAME = ['onPaneNavigated', 'offPaneNavigated', 'onPaneTitled', 'offPaneTitled'] as const

describe('watchPaneNavigations', () => {
  it('hands every reported navigation to its listener', () => {
    const { host, emit } = hostWith(EVERY_NAME)
    const seen: unknown[] = []
    watchPaneNavigations({ host, onReport: (report) => seen.push(report) })
    emit('onPaneNavigated', { id: 'pane:thread-1:tab-1', url: 'https://example.com/b' })
    expect(seen).toEqual([{ id: 'pane:thread-1:tab-1', url: 'https://example.com/b' }])
  })

  it('drops a report it cannot read', () => {
    const { host, emit } = hostWith(EVERY_NAME)
    const seen: unknown[] = []
    watchPaneNavigations({ host, onReport: (report) => seen.push(report) })
    emit('onPaneNavigated', null)
    emit('onPaneNavigated', { id: '', url: 'https://example.com/b' })
    emit('onPaneNavigated', { id: 'pane:thread-1:tab-1' })
    expect(seen).toEqual([])
  })

  it('stops listening when the caller lets go', () => {
    const { host, emit, calls } = hostWith(EVERY_NAME)
    const seen: unknown[] = []
    const stop = watchPaneNavigations({ host, onReport: (report) => seen.push(report) })
    stop()
    emit('onPaneNavigated', { id: 'pane:thread-1:tab-1', url: 'https://example.com/b' })
    expect(seen).toEqual([])
    expect(calls.map((call) => call.name)).toEqual(['onPaneNavigated', 'offPaneNavigated'])
  })

  it('does nothing on a host without the bridge', () => {
    const stop = watchPaneNavigations({ host: {}, onReport: () => undefined })
    expect(stop()).toBeUndefined()
  })
})

describe('watchPaneTitles', () => {
  it('hands every reported title to its listener', () => {
    const { host, emit, calls } = hostWith(EVERY_NAME)
    const seen: unknown[] = []
    const stop = watchPaneTitles({ host, onReport: (report) => seen.push(report) })
    emit('onPaneTitled', { id: 'pane:thread-1:tab-1', title: 'Inbox' })
    stop()
    expect(seen).toEqual([{ id: 'pane:thread-1:tab-1', title: 'Inbox' }])
    expect(calls.map((call) => call.name)).toEqual(['onPaneTitled', 'offPaneTitled'])
  })
})
