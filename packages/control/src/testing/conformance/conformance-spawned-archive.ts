import { beforeEach, describe, expect, it } from 'bun:test'
import { ETurnCause, INBOX_KIND_RECORD, inboxEventOf } from '@dltech/atlas-core'

import { ControlPlane } from '../../control-plane'
import type { ConformanceParams } from './conformance'
import { createSessionParams, HOLDER_HOST, mint, SESSION, T0 } from './support'

const PEER = 'peer-1'
const LEAF = 'leaf-a'
const LATER = '2026-11-23T12:30:00.000Z'
const LATER_STILL = '2026-11-23T12:40:00.000Z'

export function describeControlPlaneSpawnedArchive(params: ConformanceParams): void {
  describe(`ControlPlane spawned archive (${params.name})`, () => {
    let plane: ControlPlane
    let setNow: (iso: string) => void

    beforeEach(async () => {
      await params.reset()
      let now = T0
      setNow = (iso) => (now = iso)
      plane = new ControlPlane({ store: params.makeStore(), clock: () => now })
      await plane.createSession(
        createSessionParams({ sessionId: SESSION, mainThreadId: 't-root', title: 'root session' }),
      )
    })

    const prepare = async (sessionId: string): Promise<void> => {
      const threadId = `t-${sessionId}`
      const { epoch } = await plane.grant({ sessionId, hostId: HOLDER_HOST })
      const head = await plane.head({ threadId })
      const appended = await plane.append({
        threadId,
        epoch,
        events: mint({
          bodies: [{ type: 'workspace-prepared' }],
          epoch,
          from: head,
          threadId,
        }),
      })
      if (!appended.ok) throw new Error(JSON.stringify(appended.refusal))
      await plane.revoke({ sessionId, wantsHolder: false })
    }

    const spawn = async (args: {
      spawner: string
      sessionId: string
      nested?: boolean | undefined
      prepared?: boolean | undefined
    }): Promise<void> => {
      const spawned = await plane.spawnPeer({
        spawnerSessionId: args.spawner,
        sessionId: args.sessionId,
        mainThreadId: `t-${args.sessionId}`,
        title: 'Peer session',
        ...(args.nested === undefined ? {} : { nested: args.nested }),
      })
      if ('refused' in spawned) throw new Error(spawned.refused)
      if (args.prepared !== false) await prepare(args.sessionId)
    }

    const archivedAtOf = async (sessionId: string): Promise<string | null | undefined> =>
      (await plane.readSession({ sessionId }))?.archivedAt

    const recordsOf = async (sessionId: string) =>
      (await plane.readInbox({ sessionId, afterId: 0, limit: 20 })).filter(
        (entry) => entry.kind === INBOX_KIND_RECORD,
      )

    const startedTurn = async (sessionId: string): Promise<void> => {
      const threadId = `t-${sessionId}`
      const { epoch } = await plane.grant({ sessionId, hostId: HOLDER_HOST })
      const head = await plane.head({ threadId })
      const appended = await plane.append({
        threadId,
        epoch,
        events: mint({
          bodies: [{ type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }],
          epoch,
          from: head,
          threadId,
        }),
      })
      if (!appended.ok) throw new Error(JSON.stringify(appended.refusal))
    }

    it('archives an idle nested teammate, cascades to its own child and records the spawner', async () => {
      await spawn({ spawner: SESSION, sessionId: PEER })
      await spawn({ spawner: PEER, sessionId: LEAF, prepared: false })
      setNow(LATER)

      expect(await plane.archiveSpawned({ fromSessionId: SESSION, sessionId: PEER })).toEqual({
        archived: true,
        archivedAt: LATER,
        already: false,
      })
      expect(await archivedAtOf(PEER)).toBe(LATER)
      expect(await archivedAtOf(LEAF)).toBe(LATER)

      const records = await recordsOf(PEER)
      expect(records).toHaveLength(1)
      expect(records[0]?.senderSessionId).toBe(SESSION)
      expect(inboxEventOf(records[0]?.payload ?? '')).toEqual({
        ok: true,
        event: { type: 'session-archived', bySessionId: SESSION, byTitle: 'root session' },
      })
    })

    it('archives a child spawned without a nested teammate', async () => {
      await spawn({ spawner: SESSION, sessionId: PEER, nested: false })
      setNow(LATER)

      expect(await plane.archiveSpawned({ fromSessionId: SESSION, sessionId: PEER })).toEqual({
        archived: true,
        archivedAt: LATER,
        already: false,
      })
      expect(await archivedAtOf(PEER)).toBe(LATER)
    })

    it('refuses a session it did not spawn, naming the operator', async () => {
      await spawn({ spawner: SESSION, sessionId: PEER })
      await spawn({ spawner: SESSION, sessionId: 'sibling' })

      const refusal = (sessionId: string) => ({
        refused: `session ${sessionId} was not spawned by this session, so only the operator can archive it`,
      })
      expect(await plane.archiveSpawned({ fromSessionId: PEER, sessionId: 'sibling' })).toEqual(
        refusal('sibling'),
      )
      expect(await plane.archiveSpawned({ fromSessionId: PEER, sessionId: SESSION })).toEqual(
        refusal(SESSION),
      )
      expect(await plane.archiveSpawned({ fromSessionId: PEER, sessionId: PEER })).toEqual(
        refusal(PEER),
      )
      expect(await archivedAtOf('sibling')).toBeNull()
    })

    it('refuses a session of another user and a session that does not exist', async () => {
      await plane.createSession({
        ...createSessionParams({ sessionId: 'other-user', mainThreadId: 't-other-user' }),
        userId: 'user-2',
      })

      expect(
        await plane.archiveSpawned({ fromSessionId: SESSION, sessionId: 'other-user' }),
      ).toEqual({ refused: 'there is no session other-user in this project' })
      expect(await plane.archiveSpawned({ fromSessionId: SESSION, sessionId: 'missing' })).toEqual({
        refused: 'there is no session missing in this project',
      })
    })

    it('throws for a caller that is not a session', async () => {
      await expect(
        plane.archiveSpawned({ fromSessionId: 'no-caller', sessionId: SESSION }),
      ).rejects.toThrow('unknown session no-caller')
    })

    it('refuses a child that is still working', async () => {
      await spawn({ spawner: SESSION, sessionId: PEER })
      await startedTurn(PEER)

      expect(await plane.archiveSpawned({ fromSessionId: SESSION, sessionId: PEER })).toEqual({
        refused: `session ${PEER} is still working; message it with send_message or wait until it is idle`,
      })
      expect(await archivedAtOf(PEER)).toBeNull()
      expect(await recordsOf(PEER)).toEqual([])
    })

    it('reports a repeat archive as already done and posts no second record', async () => {
      await spawn({ spawner: SESSION, sessionId: PEER })
      setNow(LATER)
      await plane.archiveSpawned({ fromSessionId: SESSION, sessionId: PEER })
      setNow(LATER_STILL)

      expect(await plane.archiveSpawned({ fromSessionId: SESSION, sessionId: PEER })).toEqual({
        archived: true,
        archivedAt: LATER,
        already: true,
      })
      expect(await archivedAtOf(PEER)).toBe(LATER)
      expect(await recordsOf(PEER)).toHaveLength(1)
    })

    it('posts the record as work no holder claims', async () => {
      await spawn({ spawner: SESSION, sessionId: PEER })
      await plane.archiveSpawned({ fromSessionId: SESSION, sessionId: PEER })

      const { lease } = await plane.currentLease({ sessionId: PEER })
      expect(lease.wantsHolder).toBe(false)
      expect(lease.holderHostId).toBeNull()
    })
  })
}
