import { describe, expect, it } from 'bun:test'
import {
  ECompactionAnchor,
  EMPTY_PENDING,
  EMPTY_VISIBILITY,
  EWorkspaceStep,
  EWorkspaceStepState,
  initialFailureMessage,
  initialSessionViewState,
  SESSION_VIEW_VERSION,
  stepSessionView,
  workspaceStepsOf,
  type SessionViewState,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import { memorySessionLog, SESSION_LOG_STRUCTURE_VERSION, type SessionLog } from '../session-log'
import { restoredWindowOf } from '../session-log-restore'
import { applyPage, EMPTY_WINDOW } from '../session-window'
import { headOf, mintEvents, mintUserEvents } from './support'

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
      durable: [],
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

  it('restores no window when the cached log lacks the prefix a refold needs', async () => {
    const log = memorySessionLog()
    const events = mintUserEvents({ count: 3 })
    await log.appendPage({ sessionId: SESSION, events: events.slice(1), head: headOf(events) })
    await seedSnapshot({
      log,
      events,
      view: { ...foldOf(events.slice(0, 1)), version: SESSION_VIEW_VERSION - 1 },
    })
    expect(
      await restoredWindowOf({ log, sessionId: SESSION, renderLimit: RENDER_LIMIT }),
    ).toBeUndefined()
  })

  it('restores no window without a snapshot', async () => {
    const log = memorySessionLog()
    expect(
      await restoredWindowOf({ log, sessionId: SESSION, renderLimit: RENDER_LIMIT }),
    ).toBeUndefined()
  })
})

const setupStep = (state: EWorkspaceStepState): V2Body => ({
  type: 'workspace-step',
  step: EWorkspaceStep.Setup,
  state,
  command: 'bun install',
  attempt: 1,
})

describe('restoring the durable log', () => {
  it('carries durable events across a save and refolds them with the visible tail', async () => {
    const log = memorySessionLog()
    const events = mintEvents({
      bodies: [
        { type: 'workspace-attempt-started', attempt: 1 },
        setupStep(EWorkspaceStepState.Started),
        { type: 'user-said', text: 'go' },
        setupStep(EWorkspaceStepState.Done),
        { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
        { type: 'user-said', text: 'next' },
        {
          type: 'history-summarised',
          fromSeq: 3,
          throughSeq: 5,
          anchor: ECompactionAnchor.Prefix,
          summary: 'earlier work',
        },
      ],
    })
    await log.appendPage({ sessionId: SESSION, events, head: headOf(events) })
    const window = applyPage({
      window: EMPTY_WINDOW,
      page: { events, head: headOf(events) },
    })
    await log.saveSnapshot({
      sessionId: SESSION,
      snapshot: {
        version: SESSION_LOG_STRUCTURE_VERSION,
        cursor: window.cursor,
        visibility: window.visibility,
        pending: window.pending,
        view: window.view,
        failureMessage: window.failureMessage,
        durable: window.durable,
        commandLog: window.commandLog,
        throughSeq: window.cursor?.seq ?? 0,
      },
    })

    const restored = await restoredWindowOf({ log, sessionId: SESSION, renderLimit: RENDER_LIMIT })

    expect(restored?.durable.map((event) => event.seq)).toEqual([1, 2, 4])
    expect(
      restored?.events.some((event) => event.type === 'workspace-step' && event.state === 'done'),
    ).toBe(false)
    expect(workspaceStepsOf(restored?.foldable ?? [])[EWorkspaceStep.Setup]?.state).toBe(
      EWorkspaceStepState.Done,
    )
    expect(restored?.view.facts.setupRun).toBeNull()
  })
})
