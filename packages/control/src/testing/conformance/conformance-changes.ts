import { beforeEach, describe, expect, it } from 'bun:test'

import type { SessionChange } from '@dltech/atlas-protocol'

import { postIn } from '../../inbox-ops'
import {
  appendBodies,
  createSessionParams,
  HOLDER_HOST,
  makeHarness,
  mint,
  said,
  seedGranted,
  SESSION,
  T0,
  THREAD,
  type Harness,
} from './support'
import type { ConformanceParams } from './conformance'

const OTHER = 'changes-other'

export function describeControlPlaneChanges(params: ConformanceParams): void {
  describe(`ControlPlane changes (${params.name})`, () => {
    let harness: Harness

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
    })

    const announced = async (args: {
      sessionId?: string
      work: () => Promise<unknown>
    }): Promise<SessionChange[]> => {
      const sessionId = args.sessionId ?? SESSION
      const before = (await params.changes(sessionId)).length
      await args.work()
      return (await params.changes(sessionId)).slice(before)
    }

    const seeded = async (): Promise<number> => seedGranted(harness)

    const present = async (): Promise<{ hostId: number; release: () => Promise<void> }> => {
      const hostId = await params.nextHostId()
      return { hostId, release: await params.holdPresence(hostId) }
    }

    it('createSession announces the main thread at head 0, once', async () => {
      const changes = await announced({
        work: () =>
          harness.plane.createSession(
            createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }),
          ),
      })
      expect(changes).toEqual([{ sessionId: SESSION, threadId: THREAD, headSeq: 0 }])
    })

    it('an append of three events announces once with the final head', async () => {
      const epoch = await seeded()
      const changes = await announced({
        work: () => appendBodies({ harness, epoch, bodies: [said('a'), said('b'), said('c')] }),
      })
      expect(changes).toEqual([{ sessionId: SESSION, threadId: THREAD, headSeq: 3 }])
    })

    it('a second append announces its own head', async () => {
      const epoch = await seeded()
      await appendBodies({ harness, epoch, bodies: [said('a'), said('b')] })
      const changes = await announced({
        work: () => appendBodies({ harness, epoch, bodies: [said('c')] }),
      })
      expect(changes).toEqual([{ sessionId: SESSION, threadId: THREAD, headSeq: 3 }])
    })

    it('a refused append announces nothing', async () => {
      const epoch = await seeded()
      const head = await harness.plane.head({ threadId: THREAD })
      const stale = epoch + 1
      const changes = await announced({
        work: async () => {
          const outcome = await harness.plane.append({
            threadId: THREAD,
            epoch: stale,
            events: mint({ bodies: [said('x')], epoch: stale, from: head }),
          })
          expect(outcome.ok).toBe(false)
        },
      })
      expect(changes).toEqual([])
    })

    it('post announces the session once per post, for a message and a stop', async () => {
      await seeded()
      const message = await announced({
        work: () => harness.plane.post({ sessionId: SESSION, kind: 'user', payload: '"a"' }),
      })
      expect(message).toEqual([{ sessionId: SESSION }])
      const stop = await announced({
        work: () => harness.plane.post({ sessionId: SESSION, kind: 'stop', payload: '{}' }),
      })
      expect(stop).toEqual([{ sessionId: SESSION }])
    })

    it('takeBack announces when it deletes and nothing when refused', async () => {
      await seeded()
      const { inboxId } = await harness.plane.post({
        sessionId: SESSION,
        kind: 'user',
        payload: '"a"',
      })
      const refused = await announced({
        work: () => harness.plane.takeBack({ sessionId: SESSION, inboxId: inboxId + 40 }),
      })
      expect(refused).toEqual([])
      const taken = await announced({
        work: () => harness.plane.takeBack({ sessionId: SESSION, inboxId }),
      })
      expect(taken).toEqual([{ sessionId: SESSION }])
    })

    it('grant, plain revoke and wantsHolder revoke each announce once', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }),
      )
      const granted = await announced({
        work: () => harness.plane.grant({ sessionId: SESSION, hostId: HOLDER_HOST }),
      })
      expect(granted).toEqual([{ sessionId: SESSION }])
      const plain = await announced({
        work: () => harness.plane.revoke({ sessionId: SESSION, wantsHolder: false }),
      })
      expect(plain).toEqual([{ sessionId: SESSION }])
      await harness.plane.grant({ sessionId: SESSION, hostId: HOLDER_HOST })
      const wanting = await announced({
        work: () => harness.plane.revoke({ sessionId: SESSION, wantsHolder: true }),
      })
      expect(wanting).toEqual([{ sessionId: SESSION }])
    })

    it('revokeIfEpoch announces when it lands and nothing when the epoch is stale', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }),
      )
      const lease = await harness.plane.grant({ sessionId: SESSION, hostId: HOLDER_HOST })
      const refused = await announced({
        work: async () => {
          const result = await harness.plane.revoke({
            sessionId: SESSION,
            wantsHolder: false,
            epoch: lease.epoch + 1,
          })
          expect(result).toMatchObject({ ok: false })
        },
      })
      expect(refused).toEqual([])
      const landed = await announced({
        work: async () => {
          const result = await harness.plane.revoke({
            sessionId: SESSION,
            wantsHolder: false,
            epoch: lease.epoch,
          })
          expect(result).toMatchObject({ ok: true })
        },
      })
      expect(landed).toEqual([{ sessionId: SESSION }])
    })

    it('a winning claim announces once and a refused claim announces nothing', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }),
      )
      const first = await present()
      const second = await present()
      const won = await announced({
        work: async () => {
          const result = await harness.plane.claim({ sessionId: SESSION, hostId: first.hostId })
          expect(result.ok).toBe(true)
        },
      })
      expect(won).toEqual([{ sessionId: SESSION }])
      const refused = await announced({
        work: async () => {
          const result = await harness.plane.claim({ sessionId: SESSION, hostId: second.hostId })
          expect(result.ok).toBe(false)
        },
      })
      expect(refused).toEqual([])
      await first.release()
      await second.release()
    })

    it('wake announces each listed session once, holderless or not', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }),
      )
      await harness.plane.createSession(
        createSessionParams({ sessionId: OTHER, mainThreadId: 'changes-other-thread' }),
      )
      const before = (await params.changes(OTHER)).length
      const first = await announced({
        work: () => harness.plane.wake({ sessionIds: [SESSION, OTHER] }),
      })
      expect(first).toEqual([{ sessionId: SESSION }])
      expect((await params.changes(OTHER)).slice(before)).toEqual([{ sessionId: OTHER }])
    })

    it('a rolled-back transaction announces nothing', async () => {
      const epoch = await seeded()
      const store = params.makeStore()
      const changes = await announced({
        work: async () => {
          await expect(
            store.transact(async (tx) => {
              await tx.announce({ sessionId: SESSION })
              await postIn({ tx, sessionId: SESSION, kind: 'user', payload: '"a"', at: T0 })
              throw new Error('forced rollback')
            }),
          ).rejects.toThrow('forced rollback')
        },
      })
      expect(changes).toEqual([])
      expect(epoch).toBeGreaterThan(0)
    })
  })
}
