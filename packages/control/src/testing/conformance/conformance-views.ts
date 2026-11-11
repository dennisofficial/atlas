import { beforeEach, describe, expect, it } from 'bun:test'
import {
  ECompactionAnchor,
  EFinishReason,
  ESessionStatus,
  initialSessionViewState,
  SESSION_VIEW_VERSION,
  stepSessionView,
  type V2Body,
} from '@dltech/atlas-core'

import { decodeViewState, encodeViewState } from '../../session-view-codec'
import type { ConformanceParams } from './conformance'
import {
  appendBodies,
  makeHarness,
  mint,
  readAll,
  said,
  seedGranted,
  SESSION,
  THREAD,
  type Harness,
} from './support'

const reading = (tokens: number): V2Body => ({
  type: 'assistant-said',
  parts: [],
  finish: EFinishReason.Stop,
  usage: { inputTokens: tokens, outputTokens: 5, providerId: 'openai', modelId: 'gpt-5' },
})

const linked = (number: number): V2Body => ({
  type: 'pull-request-linked',
  number,
  url: `https://github.com/Acme/App/pull/${number}`,
  repo: 'github.com/Acme/App',
  branch: 'feat',
})

const branches: V2Body = {
  type: 'branches-observed',
  repo: '/work/app',
  head: 'feat',
  base: 'main',
  branches: [
    { name: 'main', sha: 'a1' },
    { name: 'feat', sha: 'b2' },
  ],
  worktrees: [],
}

export function describeControlPlaneViews(params: ConformanceParams): void {
  describe(`ControlPlane session view (${params.name})`, () => {
    let harness: Harness
    let epoch: number

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
      epoch = await seedGranted(harness)
    })

    const view = () => harness.plane.readSessionView({ sessionId: SESSION, threadId: THREAD })

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
      expect(state?.pullRequests).toEqual(fresh.pullRequests)
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
      expect(after?.pullRequests).toEqual(freshAfter.pullRequests)
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

    it('reads status, checkouts and linked pull requests with joined PR state', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), branches, linked(7)] })
      const first = await view()
      expect(first.value.status.state).toBe(ESessionStatus.Resuming)
      expect(first.value.status.lease).toMatchObject({ epoch, live: false })
      expect(first.value.checkouts.primary).toEqual({ repo: '/work/app', branch: 'feat' })
      expect(first.value.pullRequests).toMatchObject([{ repo: 'acme/app', number: 7, state: null }])
      await params.seedPrState?.({
        repo: 'acme/app',
        number: 7,
        title: 'Add it',
        state: 'open',
        headSha: 'b2',
        checksRunning: 1,
        checksPassed: 2,
        checksFailed: 0,
        mergeable: true,
        updatedAt: '2026-11-02T12:00:00.000Z',
      })
      const joined = await view()
      expect(joined.value.pullRequests[0]?.state).toMatchObject({
        state: 'open',
        checks: { running: 1, passed: 2, failed: 0 },
      })
    })

    it('finds the sessions linked to a pull request', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), linked(7)] })
      const store = params.makeStore()
      const found = await store.transact((tx) =>
        tx.sessionsLinkedTo({ repo: 'acme/app', number: 7 }),
      )
      const other = await store.transact((tx) =>
        tx.sessionsLinkedTo({ repo: 'acme/app', number: 8 }),
      )
      expect(found).toEqual([SESSION])
      expect(other).toEqual([])
    })

    it('a refused append leaves the row and the index untouched', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a')] })
      const head = await harness.plane.head({ threadId: THREAD })
      const events = mint({
        bodies: [linked(9), said('x'), { type: 'input-consumed', inboxId: 99 }],
        epoch,
        from: head,
      })
      const outcome = await harness.plane.append({ threadId: THREAD, epoch, events })
      expect(outcome.ok).toBe(false)
      expect((await storedState())?.at).toBe(1)
      const found = await params
        .makeStore()
        .transact((tx) => tx.sessionsLinkedTo({ repo: 'acme/app', number: 9 }))
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

    it('shows queued messages and sent status from the inbox', async () => {
      await appendBodies({ harness, epoch, bodies: [{ type: 'workspace-prepared' }] })
      await harness.plane.post({ sessionId: SESSION, kind: 'message', payload: '{"text":"hi"}' })
      const read = await view()
      expect(read.value.status.state).toBe(ESessionStatus.Sent)
      expect(read.value.status.queued?.[0]?.text).toBe('hi')
    })

    it('lists digests with the view', async () => {
      await appendBodies({ harness, epoch, bodies: [said('a'), branches, linked(7)] })
      const [bare] = await harness.plane.listSessionDigests({ userId: 'user-1', limit: 10 })
      expect(bare?.view).toBeNull()
      const [digest] = await harness.plane.listSessionDigests({
        userId: 'user-1',
        limit: 10,
        withView: true,
      })
      expect(digest?.view?.primaryBranch).toBe('feat')
      expect(digest?.view?.pullRequest).toMatchObject({ repo: 'acme/app', number: 7, state: null })
    })
  })
}
