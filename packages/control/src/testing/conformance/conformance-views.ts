import { beforeEach, describe, expect, it } from 'bun:test'
import {
  ECompactionAnchor,
  ETurnCause,
  ESessionStatus,
  initialSessionViewState,
  PLAN_TOOL_NAME,
  planView,
  planViewSchema,
  SESSION_VIEW_VERSION,
  stepSessionView,
  toCallId,
  type V2Body,
} from '@dltech/atlas-core'

import { decodeViewState, encodeViewState } from '../../session-view-codec'
import type { PrStateRow } from '../../port'
import type { ConformanceParams } from './conformance'
import { branches, linked, prStateOf, reading } from './conformance-views.fixture'
const TURN_STARTED: V2Body = { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }

import { describeControlPlaneDigests } from './conformance-views.digests'
import { describeControlPlaneDurableViews } from './conformance-views.durable'
import { describeControlPlanePullRequestViews } from './conformance-views.pull-requests'
import {
  appendBodies,
  makeHarness,
  mint,
  readAll,
  said,
  seedGranted,
  SESSION,
  T0,
  THREAD,
  type Harness,
} from './support'

export function describeControlPlaneViews(params: ConformanceParams): void {
  describeControlPlaneDigests(params)
  describeControlPlaneDurableViews(params)
  describeControlPlanePullRequestViews(params)
  describe(`ControlPlane session view (${params.name})`, () => {
    let harness: Harness
    let epoch: number

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      epoch = await seedGranted(harness)
    })

    const view = () => harness.plane.readSessionView({ sessionId: SESSION, threadId: THREAD })

    const seedPr = async (row: PrStateRow): Promise<void> => {
      const seed = params.seedPrState
      if (seed === undefined) throw new Error('the harness seeds no pull request state')
      await seed(row)
    }

    const freshFold = async () => {
      const events = await readAll({ harness, visible: false })
      return events.reduce(stepSessionView, initialSessionViewState)
    }

    const storedState = async () => {
      let state: ReturnType<typeof decodeViewState>
      await params.makeStore().transact(async (tx) => {
        const row = await tx.readSessionView(SESSION)
        state = row === undefined ? undefined : decodeViewState(row.state)
      })
      return state
    }

    const writePlan = (args: { callId: string; texts: readonly string[] }): V2Body[] => [
      {
        type: 'tool-called',
        callId: toCallId(args.callId),
        name: PLAN_TOOL_NAME,
        input: { tasks: args.texts.map((text) => ({ text, status: 'pending' })) },
        ordinal: 0,
      },
      { type: 'tool-result', callId: toCallId(args.callId), name: PLAN_TOOL_NAME, output: 'ok' },
    ]

    const overwriteRow = async (patch: { version: number; state: string; atSeq: number }) => {
      await params
        .makeStore()
        .transact((tx) => tx.writeSessionView({ sessionId: SESSION, threadId: THREAD, ...patch }))
    }

    it('equals a fresh fold after appends, a summary and a rewind', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), reading(100), branches, linked(7)] })
      await appendBodies({ harness, epoch, bodies: [said('b'), reading(200)] })
      const state = await storedState()
      const fresh = await freshFold()
      expect(state?.spend).toEqual(fresh.spend)
      expect(state?.checkouts).toEqual(fresh.checkouts)
      expect(state?.at).toBe(6)

      await appendBodies({
        harness,
        epoch,
        bodies: [
          {
            type: 'history-summarised',
            fromSeq: 1,
            throughSeq: 3,
            anchor: ECompactionAnchor.Prefix,
            summary: 'sum',
          },
        ],
      })
      await appendBodies({ harness, epoch, bodies: [{ type: 'history-rewound', toSeq: 2 }] })
      const after = await storedState()
      const freshAfter = await freshFold()
      expect(after?.at).toBe(8)
      expect(after?.spend).toEqual(freshAfter.spend)
      expect(after?.checkouts).toEqual(freshAfter.checkouts)
    })

    it('keeps spend through a rewind and forgets a meter it can no longer measure', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), reading(100), said('b')] })
      const before = await view()
      await appendBodies({ harness, epoch, bodies: [{ type: 'history-rewound', toSeq: 1 }] })
      const after = await view()
      expect(after.value.spend).toEqual(before.value.spend)
      expect(after.value.spend[0]?.inputTokens).toBe(100)
      expect(after.value.context).toBeNull()
      expect(after.at).toBe(4)
    })

    it('reads status, checkouts and a pull request derived from the branch index', async () => {
      await seedPr(prStateOf({ number: 7, state: 'open', updatedAt: '2026-11-02T12:00:00.000Z' }))
      await appendBodies({
        harness,
        epoch,
        bodies: [TURN_STARTED, said('a'), linked(99), branches],
      })
      const read = await view()
      expect(read.value.status.state).toBe(ESessionStatus.Resuming)
      expect(read.value.status.lease).toMatchObject({ epoch, live: false })
      expect(read.value.checkouts.primary).toEqual({ repo: '/work/app', branch: 'feat' })
      expect(read.value.pullRequests).toEqual([
        {
          repo: 'acme/app',
          number: 7,
          url: 'https://github.com/acme/app/pull/7',
          branch: 'feat',
          state: {
            title: 'PR 7',
            state: 'open',
            headSha: 'b2',
            checks: { running: 0, passed: 2, failed: 0, expected: 0 },
            mergeable: true,
            mergeQueued: false,
            autoMerge: false,
            updatedAt: '2026-11-02T12:00:00.000Z',
          },
        },
      ])
    })

    it('finds the sessions tracking a head', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), branches] })
      const store = params.makeStore()
      const found = await store.transact((tx) =>
        tx.sessionsTrackingHead({ headRepo: 'acme/app', branch: 'feat' }),
      )
      const other = await store.transact((tx) =>
        tx.sessionsTrackingHead({ headRepo: 'acme/app', branch: 'other' }),
      )
      const untracked = await store.transact((tx) =>
        tx.sessionsTrackingHead({ headRepo: 'acme/elsewhere', branch: 'feat' }),
      )
      expect(found).toEqual([SESSION])
      expect(other).toEqual([])
      expect(untracked).toEqual([])
    })

    it('a refused append leaves the row and the index untouched', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a')] })
      const head = await harness.plane.head({ threadId: THREAD })
      const events = mint({
        bodies: [branches, said('x'), { type: 'input-withdrawn', inboxId: 0 }],
        epoch,
        from: head,
      })
      const outcome = await harness.plane.append({ threadId: THREAD, epoch, events })
      expect(outcome.ok).toBe(false)
      expect((await storedState())?.at).toBe(1)
      const found = await params
        .makeStore()
        .transact((tx) => tx.sessionsTrackingHead({ headRepo: 'acme/app', branch: 'feat' }))
      expect(found).toEqual([])
    })

    it('catches up from no row', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), reading(100), linked(7)] })
      await params.makeStore().transact(async (tx) => {
        await tx.writeSessionView({
          sessionId: SESSION,
          threadId: THREAD,
          atSeq: 0,
          version: 0,
          state: 'x',
        })
      })
      const read = await view()
      expect(read.at).toBe(3)
      expect(read.value.spend[0]?.inputTokens).toBe(100)
    })

    it('catches up from an older version and from a lagging row', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), reading(100)] })
      const current = await storedState()
      if (current === undefined) throw new Error('no view row')
      const stale = { ...current, version: SESSION_VIEW_VERSION - 1 }
      await overwriteRow({
        version: SESSION_VIEW_VERSION - 1,
        state: encodeViewState(stale),
        atSeq: 2,
      })
      const rebuilt = await view()
      expect(rebuilt.value.spend[0]?.inputTokens).toBe(100)
      expect((await storedState())?.version).toBe(SESSION_VIEW_VERSION)

      const partial = (await readAll({ harness, visible: false }))
        .slice(0, 1)
        .reduce(stepSessionView, initialSessionViewState)
      await overwriteRow({
        version: SESSION_VIEW_VERSION,
        state: encodeViewState(partial),
        atSeq: 1,
      })
      await appendBodies({ harness, epoch, bodies: [reading(50)] })
      const read = await view()
      expect(read.at).toBe(3)
      expect(read.value.spend[0]?.inputTokens).toBe(150)
    })

    it('does not touch the row for a thread that is not the main thread', async () => {
      await harness.plane.createThread({ threadId: 'side', sessionId: SESSION })
      await appendBodies({ harness, epoch, bodies: [said('a')] })
      const before = await storedState()
      const events = mint({ bodies: [said('side'), reading(900)], epoch, threadId: 'side' })
      const outcome = await harness.plane.append({ threadId: 'side', epoch, events })
      expect(outcome.ok).toBe(true)
      expect(await storedState()).toEqual(before)
    })

    it('materializes the plan and unwinds the writes a rewind dropped', async () => {
      const viewed = makeHarness(params.makeStore(), undefined, { pluginViews: [planView] })
      const planOf = async (): Promise<readonly string[]> => {
        const read = await viewed.plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
        return planViewSchema.parse(read.value.pluginViews.plan).tasks.map((task) => task.text)
      }

      const first = await appendBodies({
        harness: viewed,
        epoch,
        bodies: [said('a'), ...writePlan({ callId: 'call-1', texts: ['one', 'two'] })],
      })
      expect(await planOf()).toEqual(['one', 'two'])

      await appendBodies({
        harness: viewed,
        epoch,
        bodies: writePlan({ callId: 'call-2', texts: ['three'] }),
      })
      expect(await planOf()).toEqual(['three'])

      await appendBodies({
        harness: viewed,
        epoch,
        bodies: [
          { type: 'history-rewound', toSeq: first.events[first.events.length - 1]?.seq ?? 0 },
        ],
      })
      expect(await planOf()).toEqual(['one', 'two'])

      await appendBodies({
        harness: viewed,
        epoch,
        bodies: [{ type: 'history-rewound', toSeq: 0 }],
      })
      expect(await planOf()).toEqual([])
    })

    it('keeps the plan through a summary', async () => {
      const viewed = makeHarness(params.makeStore(), undefined, { pluginViews: [planView] })
      await appendBodies({
        harness: viewed,
        epoch,
        bodies: [said('a'), ...writePlan({ callId: 'call-1', texts: ['one'] })],
      })
      await appendBodies({
        harness: viewed,
        epoch,
        bodies: [
          {
            type: 'history-summarised',
            fromSeq: 1,
            throughSeq: 3,
            anchor: ECompactionAnchor.Prefix,
            summary: 'sum',
          },
        ],
      })
      const read = await viewed.plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
      expect(
        planViewSchema.parse(read.value.pluginViews.plan).tasks.map((task) => task.text),
      ).toEqual(['one'])
    })

    it('shows queued messages and queued status folded from the log', async () => {
      await appendBodies({ harness, epoch, bodies: [{ type: 'workspace-prepared' }] })
      const { inboxId } = await harness.plane.post({
        sessionId: SESSION,
        kind: 'message',
        payload: '{"text":"hi","via":"operator"}',
      })
      await appendBodies({
        harness,
        epoch,
        bodies: [{ type: 'input-posted', inboxId, kind: 'message', postedAt: T0, text: 'hi' }],
      })
      const read = await view()
      expect(read.value.status.state).toBe(ESessionStatus.Queued)
      expect(read.value.status.since).toBe(read.value.status.queued?.[0]?.postedAt)
      expect(read.value.status.queued?.[0]?.text).toBe('hi')
    })
  })
}
