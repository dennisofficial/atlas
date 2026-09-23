import { describe, expect, it } from 'bun:test'

import { EToolEffect } from '@dltech/atlas-core'
import { createDeltaChannel } from '@dltech/atlas-harness'

import { createConversationStore } from '../conversation-store'
import { foldLogEvents } from '../log-accumulator'
import { createLogWindow } from '../log-window'
import { sidebarFoldFrom, sidebarFoldOf } from '../sidebar-model'
import { fixtureThreadId, log } from './fixture'

const effects = (name: string) => (name === 'Read' ? EToolEffect.Read : undefined)

const drafts = [
  { type: 'user-said', text: 'one' } as const,
  { type: 'user-said', text: 'two' } as const,
  { type: 'user-said', text: 'three' } as const,
  { type: 'user-said', text: 'four' } as const,
  { type: 'user-said', text: 'five' } as const,
]

describe('the log window', () => {
  it('folds a slid window without counting the overlap twice', () => {
    const events = log(drafts)
    const window = createLogWindow({ effects })

    window.seed({ events: events.slice(2), base: foldLogEvents({ events: events.slice(0, 2), effects }) })
    window.advance({ events: events.slice(3) })

    expect(sidebarFoldFrom(window.acc)).toEqual(sidebarFoldOf(events))
  })

  it('counts a window seeded with no base as the whole log', () => {
    const events = log(drafts)
    const window = createLogWindow({ effects })

    window.seed({ events })

    expect(sidebarFoldFrom(window.acc)).toEqual(sidebarFoldOf(events))
  })

  it('resets to a rewound log the view hands back down', () => {
    const events = log(drafts)
    const rewound = events.slice(0, 2)
    const window = createLogWindow({ effects })

    window.seed({ events })
    window.advance({ events })
    window.reset({ events: rewound, base: foldLogEvents({ events: [], effects }) })

    expect(sidebarFoldFrom(window.acc)).toEqual(sidebarFoldOf(rewound))
  })

  it('keeps the pre-window opening when the slide drops it from view', () => {
    const events = log(drafts)
    const window = createLogWindow({ effects })

    window.seed({ events: events.slice(1), base: foldLogEvents({ events: events.slice(0, 1), effects }) })
    window.advance({ events: events.slice(4) })

    expect(sidebarFoldFrom(window.acc).opening).toBe('one')
    expect(sidebarFoldFrom(window.acc).turnCount).toBe(5)
  })

  it('hands useSyncExternalStore a stable summary identity between changes', () => {
    const store = createConversationStore({
      channel: createDeltaChannel(),
      threadId: fixtureThreadId,
      effects,
    })

    expect(store.getLogSummary()).toBe(store.getLogSummary())

    store.setEvents({ events: log([{ type: 'user-said', text: 'moved' }]) })
    const moved = store.getLogSummary()
    expect(moved).toBe(store.getLogSummary())

    store.setEvents({ events: log([{ type: 'user-said', text: 'moved' }]) })
    expect(store.getLogSummary()).toBe(moved)
  })
})
