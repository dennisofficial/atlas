import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { COMPOSER_DRAFT_NEW_THREAD_SCOPE } from '@dltech/atlas-wire'

import type { ComposerDraftApi } from '../composer-draft-api'
import {
  ComposerDraftSync,
  composerDraftScope,
  composerDraftSyncFor,
  type ComposerDraftScheduler,
} from '../composer-draft-sync'

type Call = { kind: 'load' | 'save' | 'discard'; scope: string; text?: string }

function fakeApi(args?: { stored?: string | null; failing?: boolean }) {
  const calls: Call[] = []
  const api: ComposerDraftApi = {
    load: async ({ scope }) => {
      calls.push({ kind: 'load', scope })
      if (args?.failing === true) throw new Error('offline')
      return args?.stored ?? null
    },
    save: async ({ scope, text }) => {
      calls.push({ kind: 'save', scope, text })
      if (args?.failing === true) throw new Error('offline')
    },
    discard: async ({ scope }) => {
      calls.push({ kind: 'discard', scope })
      if (args?.failing === true) throw new Error('offline')
    },
  }
  return { api, calls }
}

function manualScheduler() {
  const queued = new Map<number, () => void>()
  let next = 0
  const scheduler: ComposerDraftScheduler = {
    schedule: (run) => {
      const id = next++
      queued.set(id, run)
      return () => queued.delete(id)
    },
  }
  return {
    scheduler,
    pending: () => queued.size,
    fire: () => {
      for (const [id, run] of [...queued]) {
        queued.delete(id)
        run()
      }
    },
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const syncOf = (args: { api: ComposerDraftApi; scheduler: ComposerDraftScheduler }) =>
  new ComposerDraftSync({ api: args.api, scope: 'thread-1', scheduler: args.scheduler })

describe('ComposerDraftSync', () => {
  it('coalesces a burst of edits into one put of the latest text', async () => {
    const { api, calls } = fakeApi()
    const clock = manualScheduler()
    const sync = syncOf({ api, scheduler: clock.scheduler })

    sync.handleText('h')
    sync.handleText('he')
    sync.handleText('hello')
    expect(clock.pending()).toBe(1)
    expect(calls).toEqual([])

    clock.fire()
    await settle()
    expect(calls).toEqual([{ kind: 'save', scope: 'thread-1', text: 'hello' }])
  })

  it('restores the stored draft on open', async () => {
    const { api } = fakeApi({ stored: 'half a thought' })
    const sync = syncOf({ api, scheduler: manualScheduler().scheduler })

    expect(await sync.load()).toBe('half a thought')
  })

  it('does not echo a restored draft back to the server', async () => {
    const { api, calls } = fakeApi({ stored: 'half a thought' })
    const clock = manualScheduler()
    const sync = syncOf({ api, scheduler: clock.scheduler })

    await sync.load()
    sync.handleText('half a thought')
    expect(clock.pending()).toBe(0)
    expect(calls.map((call) => call.kind)).toEqual(['load'])
  })

  it('drops a restore that arrives after the user already typed', async () => {
    const { api } = fakeApi({ stored: 'old' })
    const sync = syncOf({ api, scheduler: manualScheduler().scheduler })

    sync.handleText('new')
    expect(await sync.load()).toBeNull()
  })

  it('clears the server draft once the composer empties, cancelling a pending put', async () => {
    const { api, calls } = fakeApi()
    const clock = manualScheduler()
    const sync = syncOf({ api, scheduler: clock.scheduler })

    sync.handleText('send me')
    clock.fire()
    sync.handleText('')
    await settle()

    expect(calls).toEqual([
      { kind: 'save', scope: 'thread-1', text: 'send me' },
      { kind: 'discard', scope: 'thread-1' },
    ])

    sync.handleText('typed')
    sync.handleText('')
    expect(clock.pending()).toBe(0)
  })

  it('flushes a pending put when disposed', async () => {
    const { api, calls } = fakeApi()
    const sync = syncOf({ api, scheduler: manualScheduler().scheduler })

    sync.handleText('unsent')
    sync.dispose()
    await settle()

    expect(calls).toEqual([{ kind: 'save', scope: 'thread-1', text: 'unsent' }])
  })

  it('swallows every transport failure', async () => {
    const { api } = fakeApi({ failing: true })
    const clock = manualScheduler()
    const sync = syncOf({ api, scheduler: clock.scheduler })

    expect(await sync.load()).toBeNull()
    sync.handleText('a')
    clock.fire()
    sync.handleText('')
    await settle()
  })
})

describe('composerDraftScope', () => {
  const threadId = toThreadId('thread-1')

  it('scopes a cloud thread by its id and an unborn thread to the new scope', () => {
    expect(composerDraftScope({ threadId, cloudThread: true, unborn: false })).toBe('thread-1')
    expect(composerDraftScope({ threadId, cloudThread: false, unborn: true })).toBe(
      COMPOSER_DRAFT_NEW_THREAD_SCOPE,
    )
  })

  it('has no scope for a started local thread', () => {
    expect(composerDraftScope({ threadId, cloudThread: false, unborn: false })).toBeNull()
  })
})

describe('composerDraftSyncFor', () => {
  const api = fakeApi().api

  it('is absent without a scope or without a cloud api', () => {
    expect(composerDraftSyncFor({ cloud: { composerDraftApi: () => api }, scope: null })).toBeNull()
    expect(
      composerDraftSyncFor({ cloud: { composerDraftApi: () => null }, scope: 'thread-1' }),
    ).toBeNull()
  })

  it('is built when both exist', () => {
    expect(
      composerDraftSyncFor({ cloud: { composerDraftApi: () => api }, scope: 'thread-1' }),
    ).toBeInstanceOf(ComposerDraftSync)
  })
})
