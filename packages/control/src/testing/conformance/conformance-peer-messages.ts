import { beforeEach, describe, expect, it } from 'bun:test'

import {
  EMessageOrigin,
  SPAWN_FILE_MAX_BYTES,
  SPAWN_FILES_MAX_COUNT,
  type SpawnFile,
} from '@dltech/atlas-core'

import { ControlPlane } from '../../control-plane'
import type { ConformanceParams } from './conformance'
import { createSessionParams, PROJECT, SESSION, THREAD, T0 } from './support'

const LATER = '2026-11-09T11:00:00.000Z'

export function describeControlPlanePeerMessages(params: ConformanceParams): void {
  describe(`ControlPlane peer messages (${params.name})`, () => {
    let plane: ControlPlane

    beforeEach(async () => {
      await params.reset()
      plane = new ControlPlane({ store: params.makeStore(), clock: () => T0 })
      await plane.createSession(createSessionParams({ sessionId: SESSION, mainThreadId: THREAD }))
    })

    const spawn = async (args: {
      sessionId: string
      brief?: string | undefined
      nested?: boolean | undefined
      files?: readonly SpawnFile[] | undefined
    }) => {
      const spawned = await plane.spawnPeer({
        spawnerSessionId: SESSION,
        sessionId: args.sessionId,
        mainThreadId: `t-${args.sessionId}`,
        title: 'Peer session',
        ...(args.brief === undefined ? {} : { brief: args.brief }),
        ...(args.nested === undefined ? {} : { nested: args.nested }),
        ...(args.files === undefined ? {} : { files: args.files }),
      })
      if ('refused' in spawned) throw new Error(`the spawn was refused: ${spawned.refused}`)
      return spawned
    }

    it('carries the attached files on the spawn message, with the paths on a brief line', async () => {
      const { inboxId } = await spawn({
        sessionId: 'peer-1',
        brief: 'Take the parser.',
        files: [
          { path: 'plan.md', text: 'the plan' },
          { path: 'sections/03-auth.md', text: 'the auth section' },
        ],
      })
      expect(inboxId).toBe(1)
      const inbox = await plane.readInbox({ sessionId: 'peer-1', afterId: 0, limit: 10 })
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({
        text: 'Take the parser.\n\nAttached to $ATLAS_CONTEXT_DIR: plan.md, sections/03-auth.md',
        via: EMessageOrigin.PeerAgent,
        files: [
          { path: 'plan.md', text: 'the plan' },
          { path: 'sections/03-auth.md', text: 'the auth section' },
        ],
      })
    })

    it('posts the attached files alone when the spawn has no brief', async () => {
      const { inboxId } = await spawn({
        sessionId: 'peer-1',
        files: [{ path: 'plan.md', text: 'the plan' }],
      })
      expect(inboxId).toBe(1)
      const inbox = await plane.readInbox({ sessionId: 'peer-1', afterId: 0, limit: 10 })
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toMatchObject({
        text: 'Attached to $ATLAS_CONTEXT_DIR: plan.md',
        files: [{ path: 'plan.md', text: 'the plan' }],
      })
    })

    it('refuses an escaping path or files over the cap, and creates no session', async () => {
      const escaping = await plane.spawnPeer({
        spawnerSessionId: SESSION,
        sessionId: 'peer-1',
        mainThreadId: 'peer-thread-1',
        files: [{ path: '../x.md', text: 'x' }],
      })
      expect(escaping).toMatchObject({ refused: expect.stringContaining('../x.md') })
      const oversized = await plane.spawnPeer({
        spawnerSessionId: SESSION,
        sessionId: 'peer-2',
        mainThreadId: 'peer-thread-2',
        files: [{ path: 'big.md', text: 'x'.repeat(SPAWN_FILE_MAX_BYTES + 1) }],
      })
      expect(oversized).toMatchObject({ refused: expect.stringContaining('big.md') })
      const tooMany = await plane.spawnPeer({
        spawnerSessionId: SESSION,
        sessionId: 'peer-3',
        mainThreadId: 'peer-thread-3',
        files: Array.from({ length: SPAWN_FILES_MAX_COUNT + 1 }, (_unused, index) => ({
          path: `note-${index}.md`,
          text: 'x',
        })),
      })
      expect(tooMany).toMatchObject({
        refused: expect.stringContaining(`${SPAWN_FILES_MAX_COUNT}`),
      })
      expect(await plane.readSession({ sessionId: 'peer-1' })).toBeUndefined()
      expect(await plane.readSession({ sessionId: 'peer-2' })).toBeUndefined()
      expect(await plane.readSession({ sessionId: 'peer-3' })).toBeUndefined()
    })

    it('posts a message with the sender named', async () => {
      await spawn({ sessionId: 'peer-1' })
      const sent = await plane.messagePeer({
        fromSessionId: SESSION,
        toSessionId: 'peer-1',
        text: 'm0',
      })
      expect(sent).toEqual({ inboxId: 1 })
      const inbox = await plane.readInbox({
        sessionId: 'peer-1',
        afterId: 0,
        limit: 100,
      })
      expect(inbox.length).toBe(1)
      expect(inbox[0]?.senderSessionId).toBe(SESSION)
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({
        text: 'm0',
        via: EMessageOrigin.PeerAgent,
      })
    })

    it('lets two sessions of one user message each other with no spawn link', async () => {
      await plane.createSession(
        createSessionParams({
          sessionId: 'stranger',
          mainThreadId: 'stranger-thread',
        }),
      )
      const sent = await plane.messagePeer({
        fromSessionId: SESSION,
        toSessionId: 'stranger',
        text: 'hello',
      })
      expect(sent).toEqual({ inboxId: 1 })
      const inbox = await plane.readInbox({
        sessionId: 'stranger',
        afterId: 0,
        limit: 10,
      })
      expect(inbox[0]?.senderSessionId).toBe(SESSION)
      expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({
        text: 'hello',
        via: EMessageOrigin.PeerAgent,
      })
    })

    it('refuses a message to a session another user owns', async () => {
      await plane.createSession({
        sessionId: 'foreign',
        userId: 'another-user',
        projectId: PROJECT,
        mainThreadId: 'foreign-thread',
      })
      const refused = await plane.messagePeer({
        fromSessionId: SESSION,
        toSessionId: 'foreign',
        text: 'hello',
      })
      expect(refused).toEqual({
        refused: 'there is no session foreign in this project',
      })
      expect(await plane.readInbox({ sessionId: 'foreign', afterId: 0, limit: 10 })).toEqual([])
    })

    it('refuses a message to an archived session and posts nothing into it', async () => {
      await spawn({ sessionId: 'peer-1' })
      await plane.setSessionArchived({ sessionId: 'peer-1', archivedAt: LATER })
      const refused = await plane.messagePeer({
        fromSessionId: SESSION,
        toSessionId: 'peer-1',
        text: 'hello',
      })
      expect(refused).toEqual({
        refused: `session peer-1 is archived, so it cannot act on a message. The operator can unarchive it.`,
      })
      expect(await plane.readInbox({ sessionId: 'peer-1', afterId: 0, limit: 10 })).toEqual([])
    })

    it('refuses a report to an archived spawner and posts nothing into it', async () => {
      await spawn({ sessionId: 'peer-1', nested: false })
      await plane.setSessionArchived({ sessionId: SESSION, archivedAt: LATER })
      const refused = await plane.reportToSpawner({
        sessionId: 'peer-1',
        text: 'the parser is green',
      })
      expect(refused).toEqual({
        refused: `session ${SESSION} is archived, so it cannot act on a message. The operator can unarchive it.`,
      })
      expect(await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 10 })).toEqual([])
    })
  })
}
