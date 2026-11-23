import { beforeEach, describe, expect, it } from 'bun:test'
import { ESubscriptionActor } from '@dltech/atlas-core'

import { ControlPlane } from '../../control-plane'
import type { ConformanceParams } from './conformance'
import { createSessionParams, HOLDER_HOST, mint, SESSION, T0 } from './support'

const after = (params: { iso: string; offsetMs: number }): string =>
  new Date(Date.parse(params.iso) + params.offsetMs).toISOString()

export function describeControlPlaneSessionArchive(params: ConformanceParams): void {
  describe(`ControlPlane session archive (${params.name})`, () => {
    let plane: ControlPlane
    let setNow: (iso: string) => void

    beforeEach(async () => {
      await params.reset()
      let now = T0
      setNow = (iso) => (now = iso)
      plane = new ControlPlane({ store: params.makeStore(), clock: () => now })
    })

    const markPrepared = async (args: { sessionId: string; threadId: string }): Promise<void> => {
      const { epoch } = await plane.grant({ sessionId: args.sessionId, hostId: HOLDER_HOST })
      const head = await plane.head({ threadId: args.threadId })
      const outcome = await plane.append({
        threadId: args.threadId,
        epoch,
        events: mint({
          bodies: [{ type: 'workspace-prepared' }],
          epoch,
          from: head,
          threadId: args.threadId,
        }),
      })
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      await plane.revoke({ sessionId: args.sessionId, wantsHolder: false })
    }

    const seedSession = async (seed: {
      sessionId: string
      offsetMs: number
      prepared?: boolean
    }): Promise<void> => {
      setNow(after({ iso: T0, offsetMs: seed.offsetMs }))
      const threadId = `t-${seed.sessionId}`
      await plane.createSession(
        createSessionParams({ sessionId: seed.sessionId, mainThreadId: threadId }),
      )
      if (seed.prepared === false) return
      await markPrepared({ sessionId: seed.sessionId, threadId })
    }

    const subscribe = (args: { sessionId: string; threadId: string; number: number }) =>
      plane.subscribe({
        sessionId: args.sessionId,
        threadId: args.threadId,
        provider: 'github.pull-request',
        target: { repo: 'github.com/compai/app', number: args.number },
        label: `compai/app#${args.number}`,
        events: [],
        lease: { repo: 'compai/app', subject: { kind: 'pull-request', number: args.number } },
        by: ESubscriptionActor.Agent,
      })

    const archivedAtOf = async (sessionId: string): Promise<string | null | undefined> =>
      (await plane.readSession({ sessionId }))?.archivedAt

    it('archives every nested descendant and leaves non-nested sessions alone', async () => {
      const spawn = (args: { sessionId: string; spawner: string; nested?: boolean | undefined }) =>
        plane.spawnPeer({
          spawnerSessionId: args.spawner,
          sessionId: args.sessionId,
          mainThreadId: `t-${args.sessionId}`,
          title: 'Peer session',
          ...(args.nested === undefined ? {} : { nested: args.nested }),
        })
      const watch = ['s-root', 'peer-1', 'peer-2', 'peer-3', 'leaf-a', 'flat']
      const changesBefore = async (): Promise<Map<string, number>> => {
        const counts = new Map<string, number>()
        for (const sessionId of watch)
          counts.set(sessionId, (await params.changes(sessionId)).length)
        return counts
      }
      await seedSession({ sessionId: 's-root', offsetMs: 0 })
      await spawn({ sessionId: 'peer-1', spawner: 's-root' })
      const earlier = after({ iso: T0, offsetMs: 2000 })
      await plane.setSessionArchived({ sessionId: 'peer-1', archivedAt: earlier })
      await spawn({ sessionId: 'leaf-a', spawner: 'peer-1' })
      await spawn({ sessionId: 'peer-2', spawner: 's-root' })
      await spawn({ sessionId: 'peer-3', spawner: 'peer-2' })
      await spawn({ sessionId: 'flat', spawner: 's-root', nested: false })
      await subscribe({ sessionId: 's-root', threadId: 't-s-root', number: 7 })
      await subscribe({ sessionId: 'peer-3', threadId: 't-peer-3', number: 8 })
      const before = await changesBefore()
      const announced = async (sessionId: string): Promise<number> =>
        (await params.changes(sessionId)).length - (before.get(sessionId) ?? 0)

      const stamp = after({ iso: T0, offsetMs: 5000 })
      await plane.setSessionArchived({ sessionId: 's-root', archivedAt: stamp })

      expect(await archivedAtOf('s-root')).toBe(stamp)
      expect(await archivedAtOf('peer-1')).toBe(earlier)
      expect(await archivedAtOf('leaf-a')).toBe(stamp)
      expect(await archivedAtOf('peer-2')).toBe(stamp)
      expect(await archivedAtOf('peer-3')).toBe(stamp)
      expect(await archivedAtOf('flat')).toBeNull()
      expect(await plane.listSubscriptions({ sessionId: 's-root' })).toEqual([])
      expect(await plane.listSubscriptions({ sessionId: 'peer-3' })).toEqual([])
      expect(await announced('s-root')).toBeGreaterThan(0)
      expect(await announced('leaf-a')).toBeGreaterThan(0)
      expect(await announced('peer-2')).toBeGreaterThan(0)
      expect(await announced('peer-3')).toBeGreaterThan(0)
      expect(await announced('peer-1')).toBe(0)
      expect(await announced('flat')).toBe(0)
    })

    it('takes the lease away from a holder so it lets go of the pod', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      const held = await plane.grant({ sessionId: SESSION, hostId: HOLDER_HOST })

      await plane.setSessionArchived({
        sessionId: SESSION,
        archivedAt: after({ iso: T0, offsetMs: 5000 }),
      })

      const current = await plane.currentLease({ sessionId: SESSION })
      expect(current.lease.holderHostId).toBeNull()
      expect(current.lease.wantsHolder).toBe(false)
      expect(current.lease.epoch).toBeGreaterThan(held.epoch)
      expect(current.live).toBe(false)
      const head = await plane.head({ threadId: `t-${SESSION}` })
      const fenced = await plane.append({
        threadId: `t-${SESSION}`,
        epoch: held.epoch,
        events: mint({
          bodies: [{ type: 'workspace-prepared' }],
          epoch: held.epoch,
          from: head,
          threadId: `t-${SESSION}`,
        }),
      })
      expect(fenced.ok).toBe(false)
    })

    it('leaves the lease of a session no host holds alone', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      const before = await plane.currentLease({ sessionId: SESSION })

      await plane.setSessionArchived({
        sessionId: SESSION,
        archivedAt: after({ iso: T0, offsetMs: 5000 }),
      })
      await plane.setSessionArchived({ sessionId: SESSION, archivedAt: null })

      expect((await plane.currentLease({ sessionId: SESSION })).lease.epoch).toBe(
        before.lease.epoch,
      )
    })

    it('unarchives only the session it is given', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      await plane.spawnPeer({
        spawnerSessionId: SESSION,
        sessionId: 'peer-1',
        mainThreadId: 't-peer-1',
        title: 'Peer session',
      })
      const stamp = after({ iso: T0, offsetMs: 5000 })
      await plane.setSessionArchived({ sessionId: SESSION, archivedAt: stamp })
      await plane.setSessionArchived({ sessionId: SESSION, archivedAt: null })
      expect((await plane.readSession({ sessionId: SESSION }))?.archivedAt).toBeNull()
      expect((await plane.readSession({ sessionId: 'peer-1' }))?.archivedAt).toBe(stamp)
    })

    it('keeps an archived root stamp on a repeat archive and still archives its loose descendants', async () => {
      await seedSession({ sessionId: SESSION, offsetMs: 0 })
      await plane.spawnPeer({
        spawnerSessionId: SESSION,
        sessionId: 'peer-1',
        mainThreadId: 't-peer-1',
        title: 'Peer session',
      })
      const first = after({ iso: T0, offsetMs: 2000 })
      const again = after({ iso: T0, offsetMs: 5000 })
      await plane.setSessionArchived({ sessionId: SESSION, archivedAt: first })
      await plane.setSessionArchived({ sessionId: 'peer-1', archivedAt: null })
      await plane.setSessionArchived({ sessionId: SESSION, archivedAt: again })
      expect(await archivedAtOf(SESSION)).toBe(first)
      expect(await archivedAtOf('peer-1')).toBe(first)
    })
  })
}
