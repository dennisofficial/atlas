import { toRunId, toThreadId, type Event, type EventDraft, type ThreadId } from '@dltech/atlas-core'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

import { SHIPPED_THINKING } from '../../store'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import {
  applyTranscriptViewport,
  resetTranscriptViewport,
} from '../../ui/transcript-viewport-store'
import { THREAD_RETENTION_EVENTS, THREAD_WINDOW_EVENTS } from '../thread-reads'
import { EThreadRows, useThreadView, type ThreadView } from '../use-thread-view'
import { until } from './app-fixture'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import type { FakeEventLog } from './fake-backend'

const THREAD = toThreadId('thread-window-spec')
const RUN = toRunId('run-window-spec')

const RENDER_MS = 60

const drafts = (count: number): EventDraft[] =>
  Array.from({ length: count }, (_, index) => ({
    type: 'user-said' as const,
    text: `message ${index + 1}`,
  }))

function ranged(log: FakeEventLog): FakeEventLog {
  const branchesRead: ThreadId[] = []
  const ownReads: ThreadId[] = []
  const slice = (args: { threadId: ThreadId; fromSeq?: number; upTo?: number }): Event[] =>
    log
      .peek({ threadId: args.threadId })
      .filter(
        (event) =>
          (args.fromSeq === undefined || event.seq > args.fromSeq) &&
          (args.upTo === undefined || event.seq <= args.upTo),
      )

  return {
    branchesRead,
    ownReads,
    peek: (args) => log.peek(args),
    truncate: (args) => log.truncate(args),
    copyInto: (args) => log.copyInto(args),
    replaceWithSummary: (args) => log.replaceWithSummary(args),
    append: (args) => log.append(args),
    replace: (args) => log.replace(args),
    head: (args) => log.head(args),
    read: async (args) => {
      branchesRead.push(args.threadId)
      return slice(args)
    },
    readOwn: async (args) => {
      ownReads.push(args.threadId)
      return slice(args)
    },
  }
}

async function seededApp(count: number): Promise<FakeApp> {
  const base = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
  await base.log.append({ threadId: THREAD, runId: RUN, drafts: drafts(count) })
  return { ...base, log: ranged(base.log) }
}

type Probe = { view: ThreadView | null; events: readonly Event[] }

const NO_EVENTS: readonly Event[] = Object.freeze([])

function WindowProbe(props: { app: FakeApp; probe: Probe }): React.ReactNode {
  const view = useThreadView({
    app: props.app,
    threadId: THREAD,
    rows: EThreadRows.Own,
    thinking: SHIPPED_THINKING,
    readClock: () => 0,
  })
  props.probe.view = view
  props.probe.events = view.events

  return <text>{`${view.events.length} events held`}</text>
}

async function mountView(app: FakeApp) {
  const probe: Probe = { view: null, events: NO_EVENTS }
  const setup = await testRender(<WindowProbe app={app} probe={probe} />, { width: 60, height: 6 })

  const filled = await until({
    holds: async () => probe.events.length === THREAD_WINDOW_EVENTS,
    within: 5_000,
  })
  const view = probe.view
  if (!filled || view === null) throw new Error('the view never filled its first window')

  const heldSeqs = () => ({
    first: probe.events[0]?.seq,
    last: probe.events.at(-1)?.seq,
    length: probe.events.length,
  })

  return { probe, setup, view, heldSeqs }
}

describe('a thread view paging through a long log', () => {
  it('bounds what it retains and re-reads the evicted tail from the log', async () => {
    const app = await seededApp(THREAD_RETENTION_EVENTS + 1)
    const { probe, setup, view, heldSeqs } = await mountView(app)

    try {
      await view.loadOlder()
      await view.loadOlder()

      const paged = await until({
        holds: async () => heldSeqs().first === 1,
        within: 5_000,
      })
      if (!paged) throw new Error('paging older history never reached the top of the log')

      expect(heldSeqs().length).toBe(THREAD_RETENTION_EVENTS)
      expect(heldSeqs().last).toBe(THREAD_RETENTION_EVENTS)

      const readsBefore = app.log.ownReads.length
      applyTranscriptViewport({ tailing: false, peekKey: null })
      applyTranscriptViewport({ tailing: true, peekKey: null })

      const healed = await until({
        holds: async () => heldSeqs().last === THREAD_RETENTION_EVENTS + 1,
        within: 5_000,
      })
      if (!healed) throw new Error('scrolling back to the bottom never re-read the tail')

      expect(heldSeqs().length).toBeLessThanOrEqual(THREAD_RETENTION_EVENTS)
      expect(app.log.ownReads.length).toBeGreaterThan(readsBefore)
      expect(heldSeqs().first).toBe(2)

      const events = probe.events
      const contiguous = events.every(
        (event, index) => index === 0 || event.seq === (events[index - 1]?.seq ?? 0) + 1,
      )
      expect(contiguous).toBe(true)

      const ids = new Set(events.map((event) => event.id))
      expect(ids.size).toBe(events.length)
      expect(events.at(-1)?.id).toBe(app.log.peek({ threadId: THREAD }).at(-1)?.id)
    } finally {
      resetTranscriptViewport()
      await teardown(setup)
    }
  }, 30_000)

  it('keeps paged-in history across a refresh as the log grows', async () => {
    const app = await seededApp(2_500)
    const { setup, view, heldSeqs } = await mountView(app)

    try {
      await view.loadOlder()

      const paged = await until({
        holds: async () => heldSeqs().first === 1,
        within: 5_000,
      })
      if (!paged) throw new Error('paging older history never reached the top of the log')

      await app.log.append({
        threadId: THREAD,
        runId: RUN,
        drafts: [{ type: 'user-said', text: 'one more' }],
      })
      await view.refresh()
      await settle(RENDER_MS)

      expect(heldSeqs().first).toBe(1)
      expect(heldSeqs().last).toBe(2_501)
      expect(heldSeqs().length).toBe(2_501)
    } finally {
      resetTranscriptViewport()
      await teardown(setup)
    }
  }, 30_000)
})
