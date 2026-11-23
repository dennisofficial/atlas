import { describe, expect, test } from 'bun:test'

import { composerDraftOf, type DraftSchedule } from '../composer-draft'

type Saved = { scope: string; text: string }

const scripted = () => {
  const saved: Saved[] = []
  const cleared: string[] = []
  const timers: { run: () => void; ms: number }[] = []
  let loaded: string | null = null

  const schedule: DraftSchedule = (run, ms) => {
    timers.push({ run, ms })
    return () => {
      const at = timers.findIndex((entry) => entry.run === run)
      if (at >= 0) timers.splice(at, 1)
    }
  }

  const api = {
    loadDraft: async () => loaded,
    saveDraft: async (input: Saved) => {
      saved.push(input)
    },
    clearDraft: async (scope: string) => {
      cleared.push(scope)
    },
  }

  return {
    api,
    saved,
    cleared,
    timers,
    schedule,
    setLoaded: (text: string | null) => {
      loaded = text
    },
    fire: () => {
      for (const timer of timers.splice(0)) timer.run()
    },
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  }
}

describe('composerDraftOf', () => {
  test('coalesces two keystrokes into one save with the last text', async () => {
    const probe = scripted()
    const draft = composerDraftOf({ api: probe.api, scope: 'session-1', schedule: probe.schedule })

    draft.handleText('hel')
    draft.handleText('hello')

    expect(probe.timers).toHaveLength(1)
    probe.fire()
    await probe.settle()

    expect(probe.saved).toEqual([{ scope: 'session-1', text: 'hello' }])
  })

  test('waits the debounce interval', () => {
    const probe = scripted()
    const draft = composerDraftOf({
      api: probe.api,
      scope: 'session-1',
      debounceMs: 750,
      schedule: probe.schedule,
    })

    draft.handleText('hello')

    expect(probe.timers[0]?.ms).toBe(750)
  })

  test('clears the stored draft once when a saved draft goes blank', async () => {
    const probe = scripted()
    const draft = composerDraftOf({ api: probe.api, scope: 'session-1', schedule: probe.schedule })

    draft.handleText('hello')
    probe.fire()
    await probe.settle()

    draft.handleText('   ')
    draft.handleText('')
    await probe.settle()

    expect(probe.saved).toEqual([{ scope: 'session-1', text: 'hello' }])
    expect(probe.cleared).toEqual(['session-1'])
  })

  test('a draft that never left the editor is not cleared on the server', async () => {
    const probe = scripted()
    const draft = composerDraftOf({ api: probe.api, scope: 'session-1', schedule: probe.schedule })

    draft.handleText('hello')
    draft.handleText('')

    await probe.settle()
    expect(probe.cleared).toEqual([])
    expect(probe.saved).toEqual([])
  })

  test('returns a stored draft, and null once the operator has typed', async () => {
    const probe = scripted()
    probe.setLoaded('half typed')
    const draft = composerDraftOf({ api: probe.api, scope: 'session-1', schedule: probe.schedule })
    expect(await draft.load()).toBe('half typed')

    const typed = scripted()
    typed.setLoaded('half typed')
    const other = composerDraftOf({ api: typed.api, scope: 'session-1', schedule: typed.schedule })
    other.handleText('mine')
    expect(await other.load()).toBeNull()
  })

  test('a blank stored draft is not restored', async () => {
    const probe = scripted()
    probe.setLoaded('   \n  ')
    const draft = composerDraftOf({ api: probe.api, scope: 'session-1', schedule: probe.schedule })

    expect(await draft.load()).toBeNull()
  })

  test('dispose flushes the pending save', async () => {
    const probe = scripted()
    const draft = composerDraftOf({ api: probe.api, scope: 'session-1', schedule: probe.schedule })

    draft.handleText('not yet')
    draft.dispose()
    await probe.settle()

    expect(probe.saved).toEqual([{ scope: 'session-1', text: 'not yet' }])
  })
})
