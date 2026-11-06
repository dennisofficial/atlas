import { beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '../../control-plane'
import type { ConformanceParams } from './conformance'
import { createSessionParams, SESSION, T0, THREAD, USER } from './support'

const LATER = '2026-11-02T12:00:05.000Z'

export function describeControlPlaneSessionTitles(params: ConformanceParams): void {
  describe(`ControlPlane session titles (${params.name})`, () => {
    let plane: ControlPlane
    let now = T0

    beforeEach(async () => {
      await params.reset()
      now = T0
      plane = new ControlPlane({ store: params.makeStore(), clock: () => now })
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
    })

    const changesDuring = async (work: () => Promise<unknown>) => {
      const before = (await params.changes(SESSION)).length
      const wakesBefore = await params.wakes(SESSION)
      await work()
      return {
        changes: (await params.changes(SESSION)).slice(before),
        wakes: (await params.wakes(SESSION)) - wakesBefore,
      }
    }

    it('titles an untitled session once, announcing without waking', async () => {
      const first = await changesDuring(() =>
        plane.titleUntitledSession({ sessionId: SESSION, title: 'Build Fix' }),
      )
      expect(first).toEqual({ changes: [{ sessionId: SESSION }], wakes: 0 })
      expect((await plane.readSession({ sessionId: SESSION }))?.title).toBe('Build Fix')

      const second = await changesDuring(async () => {
        expect(await plane.titleUntitledSession({ sessionId: SESSION, title: 'Other' })).toBe(false)
      })
      expect(second).toEqual({ changes: [], wakes: 0 })
      expect((await plane.readSession({ sessionId: SESSION }))?.title).toBe('Build Fix')
    })

    it('never overwrites a title given at creation', async () => {
      await plane.createSession(
        createSessionParams({ sessionId: 'titled', mainThreadId: 't-titled', title: 'Kept' }),
      )
      expect(await plane.titleUntitledSession({ sessionId: 'titled', title: 'New' })).toBe(false)
      expect((await plane.readSession({ sessionId: 'titled' }))?.title).toBe('Kept')
    })

    it('answers false for an unknown session', async () => {
      expect(await plane.titleUntitledSession({ sessionId: 'nope', title: 'X' })).toBe(false)
    })

    it('archiving announces the session without waking it', async () => {
      const archived = await changesDuring(() =>
        plane.setSessionArchived({ sessionId: SESSION, archivedAt: LATER }),
      )
      expect(archived).toEqual({ changes: [{ sessionId: SESSION }], wakes: 0 })
    })

    it('digests carry the first message time and filter to one session', async () => {
      await plane.createSession(createSessionParams({ sessionId: 'other', mainThreadId: 't-o' }))
      now = LATER
      await plane.post({ sessionId: SESSION, kind: 'message', payload: '{"text":"hello"}' })
      const one = await plane.listSessionDigests({ userId: USER, sessionId: SESSION, limit: 10 })
      expect(one.map((row) => [row.sessionId, row.firstMessageText, row.firstMessageAt])).toEqual([
        [SESSION, 'hello', LATER],
      ])
      const other = await plane.listSessionDigests({ userId: USER, sessionId: 'other', limit: 10 })
      expect(other.map((row) => [row.sessionId, row.firstMessageAt])).toEqual([['other', null]])
      const stranger = await plane.listSessionDigests({
        userId: 'someone-else',
        sessionId: SESSION,
        limit: 10,
      })
      expect(stranger).toEqual([])
    })
  })
}
