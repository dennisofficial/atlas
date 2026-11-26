import { describe, expect, it } from 'bun:test'

import type { ControlPlane } from '@dltech/atlas-control'

import { CrewRoom, type CrewRoomArgs } from '../crew-room'
import { openChildren } from '../open-children'
import {
  BRIEF,
  PARENT,
  SESSION,
  briefsOf,
  flush,
  ofType,
  rigOf,
  roomOf,
  spawnInStep,
} from './spawn-step-rig'

const WORKTREE = { path: '/work/.atlas/worktrees/topic', branch: 'topic', base: 'origin/main' }

const crashingPlaneOf = (plane: ControlPlane): ControlPlane =>
  new Proxy(plane, {
    get: (target, property) => {
      const value = Reflect.get(target, property)
      if (property !== 'post') return typeof value === 'function' ? value.bind(target) : value
      return async (post: Parameters<ControlPlane['post']>[0]) => {
        if (post.threadId !== undefined)
          throw new Error('host killed immediately before brief post')
        return await target.post(post)
      }
    },
  })

describe('a worktree-seeded child whose host died before its brief', () => {
  it('gets its one brief from the replay that adopts it, and no second one', async () => {
    const { room, parent, plane, epoch } = await rigOf()
    const args = Reflect.get(room, 'args') as CrewRoomArgs
    const original = new CrewRoom({
      ...args,
      deps: { ...args.deps, plane: crashingPlaneOf(plane) },
    })
    const spawn = (target: CrewRoom) =>
      spawnInStep(() =>
        target.spawn({
          agentType: 'general-purpose',
          intent: 'probe',
          prompt: BRIEF,
          worktree: WORKTREE,
        }),
      )
    await expect(spawn(original)).rejects.toThrow('host killed')
    const child = ofType(parent.events, 'agent-spawned')[0]
    if (child === undefined) throw new Error('the spawn recorded no child before it crashed')

    const takeover = roomOf({ plane, parent, epoch })
    await takeover.adoptAll(
      await openChildren({
        record: parent.record,
        plane,
        sessionId: SESSION,
        threadId: PARENT,
      }),
    )
    try {
      const replay = await spawn(takeover)
      await flush()

      expect(replay.agentId).toBe(child.agentId)

      const again = await spawn(takeover)
      await flush()

      expect(again.agentId).toBe(child.agentId)
      expect(await briefsOf({ plane, agentId: child.agentId })).toEqual([BRIEF])
    } finally {
      await takeover.stopAll()
    }
  })
})
