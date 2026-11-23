import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'

import { ControlPlane } from '../../control-plane'
import type { ConformanceParams } from './conformance'
import { createSessionParams, said, T0, USER } from './support'

const HOST = 9101
const HOUR_MS = 60 * 60 * 1000

const after = (params: { iso: string; offsetMs: number }): string =>
  new Date(Date.parse(params.iso) + params.offsetMs).toISOString()

const cutoff = after({ iso: T0, offsetMs: 72 * HOUR_MS })

export function describeControlPlaneSessionBuckets(params: ConformanceParams): void {
  describe(`ControlPlane session buckets (${params.name})`, () => {
    let plane: ControlPlane
    let setNow: (iso: string) => void

    beforeEach(async () => {
      await params.reset()
      let now = T0
      setNow = (iso) => (now = iso)
      plane = new ControlPlane({ store: params.makeStore(), clock: () => now })
    })

    afterEach(() => undefined)

    const seed = async (seedArgs: {
      sessionId: string
      offsetMs: number
      title?: string | undefined
    }): Promise<string> => {
      setNow(after({ iso: T0, offsetMs: seedArgs.offsetMs }))
      const threadId = `t-${seedArgs.sessionId}`
      await plane.createSession({
        ...createSessionParams({ sessionId: seedArgs.sessionId, mainThreadId: threadId }),
        ...(seedArgs.title === undefined ? {} : { title: seedArgs.title }),
      })
      return threadId
    }

    const appendAt = async (args: {
      sessionId: string
      threadId: string
      at: string
      text: string
    }): Promise<void> => {
      const lease = await plane.grant({ sessionId: args.sessionId, hostId: HOST })
      const outcome = await plane.append({
        threadId: args.threadId,
        epoch: lease.epoch,
        events: chainEvents({
          threadId: toThreadId(args.threadId),
          runId: toRunId('run-1'),
          epoch: lease.epoch,
          at: args.at,
          bodies: [said(args.text)],
          from: await plane.head({ threadId: args.threadId }),
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
    }

    const post = (args: { sessionId: string; text: string }): Promise<{ inboxId: number }> =>
      plane.post({
        sessionId: args.sessionId,
        kind: 'message',
        payload: JSON.stringify({ text: args.text, via: 'operator' }),
      })

    it('pages the archived bucket by creation keyset without repeating a row', async () => {
      for (const [index, sessionId] of ['s-a', 's-b', 's-c'].entries()) {
        await seed({ sessionId, offsetMs: index * 1000 })
        await plane.setSessionArchived({
          sessionId,
          archivedAt: after({ iso: T0, offsetMs: index * 1000 }),
        })
      }
      await seed({ sessionId: 's-live', offsetMs: 5000 })

      const first = await plane.listSessionDigests({
        userId: USER,
        limit: 2,
        bucket: { archived: true },
      })
      expect(first.map((row) => row.sessionId)).toEqual(['s-c', 's-b'])
      const last = first.at(-1)
      if (last === undefined) throw new Error('no digest row')
      const second = await plane.listSessionDigests({
        userId: USER,
        limit: 2,
        bucket: { archived: true },
        after: { createdAt: last.createdAt, sessionId: last.sessionId },
      })
      expect(second.map((row) => row.sessionId)).toEqual(['s-a'])
    })

    it('leaves out a live session from the inactive bucket when its last event is newer than the cutoff', async () => {
      await seed({ sessionId: 's-stale', offsetMs: 0 })
      const busyThread = await seed({ sessionId: 's-busy', offsetMs: 1000 })
      await appendAt({
        sessionId: 's-busy',
        threadId: busyThread,
        at: after({ iso: cutoff, offsetMs: HOUR_MS }),
        text: 'still here',
      })
      const oldThread = await seed({ sessionId: 's-old', offsetMs: 2000 })
      await appendAt({
        sessionId: 's-old',
        threadId: oldThread,
        at: after({ iso: T0, offsetMs: HOUR_MS }),
        text: 'long ago',
      })

      const inactive = await plane.listSessionDigests({
        userId: USER,
        limit: 10,
        bucket: { archived: false, idleBefore: cutoff },
      })
      expect(inactive.map((row) => row.sessionId)).toEqual(['s-old', 's-stale'])
    })

    it('searches the title and the first posted message', async () => {
      await seed({ sessionId: 's-titled', offsetMs: 0, title: 'Quarterly report' })
      await seed({ sessionId: 's-spoken', offsetMs: 1000 })
      await post({ sessionId: 's-spoken', text: 'a needle in the haystack' })
      await seed({ sessionId: 's-quiet', offsetMs: 2000 })

      const byTitle = await plane.listSessionDigests({
        userId: USER,
        limit: 10,
        search: 'quarterly',
      })
      expect(byTitle.map((row) => row.sessionId)).toEqual(['s-titled'])
      const byMessage = await plane.listSessionDigests({
        userId: USER,
        limit: 10,
        search: 'needle',
      })
      expect(byMessage.map((row) => row.sessionId)).toEqual(['s-spoken'])
    })

    it('counts the archived and inactive buckets and scopes them by search', async () => {
      await seed({ sessionId: 's-archived', offsetMs: 0, title: 'keep me' })
      await plane.setSessionArchived({
        sessionId: 's-archived',
        archivedAt: after({ iso: T0, offsetMs: 1000 }),
      })
      await seed({ sessionId: 's-stale', offsetMs: 1000, title: 'keep me too' })
      await seed({ sessionId: 's-new', offsetMs: 2000, title: 'something else' })
      await appendAt({
        sessionId: 's-new',
        threadId: 't-s-new',
        at: after({ iso: cutoff, offsetMs: HOUR_MS }),
        text: 'fresh',
      })

      expect(await plane.countSessionBuckets({ userId: USER, idleBefore: cutoff })).toEqual({
        inactive: 1,
        archived: 1,
      })
      expect(
        await plane.countSessionBuckets({ userId: USER, idleBefore: cutoff, search: 'keep' }),
      ).toEqual({ inactive: 1, archived: 1 })
      expect(
        await plane.countSessionBuckets({ userId: USER, idleBefore: cutoff, search: 'else' }),
      ).toEqual({ inactive: 0, archived: 0 })
    })
  })
}
