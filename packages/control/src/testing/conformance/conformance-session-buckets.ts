import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'

import { ControlPlane } from '../../control-plane'
import type { ConformanceParams } from './conformance'
import { createSessionParams, said, T0, USER } from './support'

const HOST = 9101
const HOUR_MS = 60 * 60 * 1000

const after = (params: { iso: string; offsetMs: number }): string =>
  new Date(Date.parse(params.iso) + params.offsetMs).toISOString()

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
        archivedOnly: true,
      })
      expect(first.map((row) => row.sessionId)).toEqual(['s-c', 's-b'])
      const last = first.at(-1)
      if (last === undefined) throw new Error('no digest row')
      const second = await plane.listSessionDigests({
        userId: USER,
        limit: 2,
        archivedOnly: true,
        after: { createdAt: last.createdAt, sessionId: last.sessionId },
      })
      expect(second.map((row) => row.sessionId)).toEqual(['s-a'])
    })

    it('lists an old unarchived session with the live ones and keeps it out of the archived page', async () => {
      const oldThread = await seed({ sessionId: 's-old', offsetMs: 0 })
      await appendAt({
        sessionId: 's-old',
        threadId: oldThread,
        at: after({ iso: T0, offsetMs: HOUR_MS }),
        text: 'long ago',
      })
      await seed({ sessionId: 's-newer', offsetMs: 100 * HOUR_MS })

      const live = await plane.listSessionDigests({ userId: USER, limit: 10 })
      expect(live.map((row) => row.sessionId)).toEqual(['s-newer', 's-old'])
      const archived = await plane.listSessionDigests({
        userId: USER,
        limit: 10,
        archivedOnly: true,
      })
      expect(archived).toEqual([])
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

    it('counts the archived bucket and scopes the count by search', async () => {
      await seed({ sessionId: 's-archived', offsetMs: 0, title: 'keep me' })
      await plane.setSessionArchived({
        sessionId: 's-archived',
        archivedAt: after({ iso: T0, offsetMs: 1000 }),
      })
      await seed({ sessionId: 's-live', offsetMs: 1000, title: 'keep me too' })
      await seed({ sessionId: 's-other', offsetMs: 2000, title: 'something else' })

      expect(await plane.countSessionBuckets({ userId: USER })).toEqual({ archived: 1 })
      expect(await plane.countSessionBuckets({ userId: USER, search: 'keep' })).toEqual({
        archived: 1,
      })
      expect(await plane.countSessionBuckets({ userId: USER, search: 'else' })).toEqual({
        archived: 0,
      })
    })
  })
}
