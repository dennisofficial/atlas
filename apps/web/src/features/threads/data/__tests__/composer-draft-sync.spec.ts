import { describe, expect, it } from 'bun:test'

import type { SaidUpload } from '@dltech/atlas-core'

import { createDraftSync, DRAFT_DEBOUNCE_MS, type DraftSchedule } from '../composer-draft-sync'

const upload: SaidUpload = {
  uploadId: '11111111-1111-4111-8111-111111111111',
  pathname: 'u/a.txt',
  name: 'a.txt',
  size: 3,
  mediaType: 'text/plain',
}

function setup(options: { failPut?: boolean } = {}) {
  const puts: { scope: string; text: string; uploads: readonly SaidUpload[] }[] = []
  const clears: string[] = []
  const timers: { run: () => void; delayMs: number; live: boolean }[] = []
  const schedule: DraftSchedule = (run, delayMs) => {
    const timer = { run, delayMs, live: true }
    timers.push(timer)
    return () => {
      timer.live = false
    }
  }
  const sync = createDraftSync({
    scope: 't1',
    schedule,
    put: async (args) => {
      puts.push(args)
      if (options.failPut) throw new Error('offline')
    },
    clear: async (scope) => {
      clears.push(scope)
    },
  })
  const fire = async () => {
    for (const timer of timers) {
      if (!timer.live) continue
      timer.live = false
      timer.run()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { sync, puts, clears, timers, fire }
}

describe('createDraftSync', () => {
  it('coalesces rapid changes into one put with the latest content', async () => {
    const { sync, puts, timers, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'h', uploads: [] })
    sync.change({ text: 'he', uploads: [] })
    sync.change({ text: 'hel', uploads: [] })
    expect(timers.filter((timer) => timer.live)).toHaveLength(1)
    expect(timers[0]?.delayMs).toBe(DRAFT_DEBOUNCE_MS)
    await fire()
    expect(puts).toEqual([{ scope: 't1', text: 'hel', uploads: [] }])
  })

  it('does not write while the initial fetch is loading', async () => {
    const { sync, puts, timers, fire } = setup()
    sync.change({ text: '', uploads: [] })
    expect(timers).toHaveLength(0)
    await fire()
    expect(puts).toHaveLength(0)
  })

  it('writes what the user typed during a slow fetch instead of the stored draft', async () => {
    const { sync, puts, fire } = setup()
    sync.change({ text: 'typed', uploads: [] })
    expect(sync.loaded({ text: 'old', uploads: [] })).toBeNull()
    await fire()
    expect(puts).toEqual([{ scope: 't1', text: 'typed', uploads: [] }])
  })

  it('returns the stored draft to restore and does not write it back', async () => {
    const { sync, puts, timers, fire } = setup()
    sync.change({ text: '', uploads: [] })
    const restored = sync.loaded({ text: 'saved', uploads: [upload] })
    expect(restored).toEqual({ text: 'saved', uploads: [upload] })
    sync.change({ text: 'saved', uploads: [{ ...upload }] })
    expect(timers).toHaveLength(0)
    await fire()
    expect(puts).toHaveLength(0)
  })

  it('writes again once the user edits a restored draft', async () => {
    const { sync, puts, fire } = setup()
    sync.change({ text: '', uploads: [] })
    sync.loaded({ text: 'saved', uploads: [] })
    sync.change({ text: 'saved!', uploads: [] })
    await fire()
    expect(puts).toEqual([{ scope: 't1', text: 'saved!', uploads: [] }])
  })

  it('writes an attachment-only change', async () => {
    const { sync, puts, fire } = setup()
    sync.loaded(null)
    sync.change({ text: '', uploads: [upload] })
    await fire()
    expect(puts).toEqual([{ scope: 't1', text: '', uploads: [upload] }])
  })

  it('clears the server draft after a send and cancels a pending put', async () => {
    const { sync, puts, clears, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'ship it', uploads: [] })
    sync.handleSent('ship it')
    await fire()
    expect(clears).toEqual(['t1'])
    expect(puts).toHaveLength(0)
  })

  it('does not write the sent text back while the composer still shows it', async () => {
    const { sync, puts, clears, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'ship it', uploads: [] })
    await fire()
    sync.handleSent('ship it')
    sync.change({ text: 'ship it', uploads: [] })
    await fire()
    sync.change({ text: '', uploads: [] })
    await fire()
    expect(puts).toHaveLength(1)
    expect(clears).toEqual(['t1'])
  })

  it('writes normally once the user types after a send', async () => {
    const { sync, puts, fire } = setup()
    sync.loaded(null)
    sync.handleSent('done')
    sync.change({ text: 'next', uploads: [] })
    await fire()
    expect(puts).toEqual([{ scope: 't1', text: 'next', uploads: [] }])
  })

  it('clears the server draft when the composer is emptied by the user', async () => {
    const { sync, clears, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'a', uploads: [] })
    await fire()
    sync.change({ text: '', uploads: [] })
    await fire()
    expect(clears).toEqual(['t1'])
  })

  it('swallows put failures and keeps syncing later changes', async () => {
    const { sync, puts, fire } = setup({ failPut: true })
    sync.loaded(null)
    sync.change({ text: 'a', uploads: [] })
    await fire()
    sync.change({ text: 'ab', uploads: [] })
    await fire()
    expect(puts.map((put) => put.text)).toEqual(['a', 'ab'])
  })

  it('flushes a pending write on demand and ignores changes after dispose', async () => {
    const { sync, puts, fire } = setup()
    sync.loaded(null)
    sync.change({ text: 'pending', uploads: [] })
    sync.flush()
    sync.dispose()
    sync.change({ text: 'late', uploads: [] })
    await fire()
    expect(puts.map((put) => put.text)).toEqual(['pending'])
  })

  it('ignores a fetch that resolves after dispose', () => {
    const { sync } = setup()
    sync.dispose()
    expect(sync.loaded({ text: 'saved', uploads: [] })).toBeNull()
  })
})
