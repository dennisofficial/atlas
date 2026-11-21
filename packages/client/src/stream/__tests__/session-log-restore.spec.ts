import { describe, expect, it } from 'bun:test'
import {
  EMPTY_PENDING,
  EMPTY_VISIBILITY,
  initialFailureMessage,
  initialSessionViewState,
  SESSION_VIEW_VERSION,
  stepSessionView,
  type SessionViewState,
  type V2Event,
} from '@dltech/atlas-core'

import { memorySessionLog, SESSION_LOG_STRUCTURE_VERSION, type SessionLog } from '../session-log'
import { restoredWindowOf } from '../session-log-restore'
import { headOf, mintUserEvents } from './support'

const SESSION = 'session-1'
const RENDER_LIMIT = 100

const foldOf = (events: readonly V2Event[]): SessionViewState =>
  events.reduce(stepSessionView, initialSessionViewState)

const seedSnapshot = async (args: {
  log: SessionLog
  events: readonly V2Event[]
  view: SessionViewState
}): Promise<void> =>
  args.log.saveSnapshot({
    sessionId: SESSION,
    snapshot: {
      version: SESSION_LOG_STRUCTURE_VERSION,
      cursor: headOf(args.events),
      visibility: EMPTY_VISIBILITY,
      pending: EMPTY_PENDING,
      view: args.view,
      failureMessage: initialFailureMessage,
      commandLog: [],
      throughSeq: args.events.length,
    },
  })

const seeded = async (args: { version: number; foldedEventCount: number }) => {
  const log = memorySessionLog()
  const events = mintUserEvents({ count: 3 })
  await log.appendPage({ sessionId: SESSION, events, head: headOf(events) })
  const folded = foldOf(events.slice(0, args.foldedEventCount))
  await seedSnapshot({ log, events, view: { ...folded, version: args.version } })
  return { log, events }
}

describe('restoring the cached session view', () => {
  it('keeps a view folded by the current version as the base for the gap', async () => {
    const { log } = await seeded({ version: SESSION_VIEW_VERSION, foldedEventCount: 1 })
    const window = await restoredWindowOf({ log, sessionId: SESSION, renderLimit: RENDER_LIMIT })
    expect(window?.view.at).toBe(1)
  })

  it('refolds a view folded by an older version from the cached log', async () => {
    const { log, events } = await seeded({
      version: SESSION_VIEW_VERSION - 1,
      foldedEventCount: 1,
    })
    const window = await restoredWindowOf({ log, sessionId: SESSION, renderLimit: RENDER_LIMIT })
    expect(window?.view.version).toBe(SESSION_VIEW_VERSION)
    expect(window?.view).toEqual(foldOf(events))
  })

  it('keeps the rest of the snapshot when it refolds the view', async () => {
    const { log } = await seeded({ version: SESSION_VIEW_VERSION - 1, foldedEventCount: 1 })
    const window = await restoredWindowOf({ log, sessionId: SESSION, renderLimit: RENDER_LIMIT })
    expect(window?.pending).toEqual(EMPTY_PENDING)
    expect(window?.visibility).toEqual(EMPTY_VISIBILITY)
    expect(window?.commandLog).toEqual([])
    expect(window?.events).toHaveLength(3)
  })

  it('restores no window when the cached log cannot be read for the refold', async () => {
    const { log } = await seeded({ version: SESSION_VIEW_VERSION - 1, foldedEventCount: 1 })
    const broken: SessionLog = {
      ...log,
      readRange: () => Promise.reject(new Error('the cache is gone')),
    }
    expect(
      await restoredWindowOf({ log: broken, sessionId: SESSION, renderLimit: RENDER_LIMIT }),
    ).toBeUndefined()
  })

  it('restores no window without a snapshot', async () => {
    const log = memorySessionLog()
    expect(
      await restoredWindowOf({ log, sessionId: SESSION, renderLimit: RENDER_LIMIT }),
    ).toBeUndefined()
  })
})
