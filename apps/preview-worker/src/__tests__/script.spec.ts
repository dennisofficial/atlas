import { describe, expect, it } from 'bun:test'

import { SCRIPT_SOURCE } from '../script'

type Listener = (event: unknown) => void

function boot(args: { framed: boolean }) {
  const posted: unknown[] = []
  const calls: string[] = []
  const listeners: Record<string, Listener[]> = {}
  const parent = { postMessage: (message: unknown) => posted.push(message) }
  const fake: Record<string, unknown> = {
    location: { href: 'https://3000-abcdefghij.byatlas.dev/a', reload: () => calls.push('reload') },
    document: { title: 'Page', head: null },
    history: {
      pushState: () => undefined,
      replaceState: () => undefined,
      back: () => calls.push('back'),
      forward: () => calls.push('forward'),
    },
    addEventListener: (name: string, listener: Listener) => {
      listeners[name] = [...(listeners[name] ?? []), listener]
    },
  }
  fake.parent = args.framed ? parent : fake
  new Function('window', SCRIPT_SOURCE)(fake)
  const emit = (name: string, event?: unknown) => {
    for (const listener of listeners[name] ?? []) listener(event)
  }
  return { fake, parent, posted, calls, listeners, emit }
}

describe('injected script', () => {
  it('does nothing outside a frame', () => {
    const { listeners, posted } = boot({ framed: false })
    expect(Object.keys(listeners)).toHaveLength(0)
    expect(posted).toHaveLength(0)
  })

  it('reports the location on load and after pushState', () => {
    const { fake, emit, posted } = boot({ framed: true })
    emit('load')
    expect(posted).toEqual([
      {
        kind: 'atlas-preview:location',
        url: 'https://3000-abcdefghij.byatlas.dev/a',
        title: 'Page',
      },
    ])
    emit('load')
    expect(posted).toHaveLength(1)
    ;(fake.location as { href: string }).href = 'https://3000-abcdefghij.byatlas.dev/b'
    ;(fake.history as { pushState: () => void }).pushState()
    expect(posted).toHaveLength(2)
    emit('popstate')
    emit('hashchange')
    expect(posted).toHaveLength(2)
  })

  it('tells the parent a navigation started when the page unloads', () => {
    const { emit, posted } = boot({ framed: true })
    emit('beforeunload')
    expect(posted).toEqual([{ kind: 'atlas-preview:loading' }])
  })

  it('obeys commands only from the parent with an Atlas origin', () => {
    const { parent, emit, calls } = boot({ framed: true })
    const command = (command: string) => ({ kind: 'atlas-preview:command', command })
    emit('message', { source: parent, origin: 'https://byatlas.io', data: command('back') })
    emit('message', { source: parent, origin: 'http://localhost:3001', data: command('forward') })
    emit('message', { source: parent, origin: 'https://byatlas.io', data: command('reload') })
    expect(calls).toEqual(['back', 'forward', 'reload'])
    emit('message', { source: parent, origin: 'https://evil.com', data: command('back') })
    emit('message', {
      source: parent,
      origin: 'https://byatlas.io.evil.com',
      data: command('back'),
    })
    emit('message', { source: {}, origin: 'https://byatlas.io', data: command('back') })
    emit('message', {
      source: parent,
      origin: 'https://byatlas.io',
      data: { kind: 'other', command: 'back' },
    })
    emit('message', { source: parent, origin: 'https://byatlas.io', data: command('explode') })
    emit('message', { source: parent, origin: 'https://byatlas.io', data: null })
    expect(calls).toEqual(['back', 'forward', 'reload'])
  })
})
