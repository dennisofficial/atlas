import { expect, it } from 'bun:test'

import { ScriptedModel } from '@dltech/atlas-agent/testing'

import { CrewRoom, type CrewRoomArgs } from '../crew-room'
import { openChildren } from '../open-children'
import {
  BRIEF,
  PARENT,
  SESSION,
  briefsOf,
  flush,
  rigOf,
  roomOf,
  spawnInStep,
} from './spawn-step-rig'

it('keeps a running briefed child addressable while its spawn result is held', async () => {
  const { room, parent, plane, epoch } = await rigOf()
  const args = Reflect.get(room, 'args') as CrewRoomArgs
  const model = new ScriptedModel(
    [{ gateFile: '/never', text: 'finished' }],
    undefined,
    () => false,
  )
  const original = new CrewRoom({
    ...args,
    runtime: { ...args.runtime, model, modelOf: () => model },
  })
  try {
    const first = await spawnInStep(() =>
      original.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    await flush()
    expect(original.hasRunning()).toBe(true)
    expect(await briefsOf({ plane, agentId: first.agentId })).toEqual([BRIEF])
    const takeover = roomOf({ plane, parent, epoch })
    await takeover.adoptAll(
      await openChildren({
        record: parent.record,
        plane,
        sessionId: SESSION,
        threadId: PARENT,
      }),
    )
    expect(() => takeover.stop({ agentId: first.agentId })).not.toThrow()
    const replay = await spawnInStep(() =>
      takeover.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    expect(replay.agentId).toBe(first.agentId)
    expect(await briefsOf({ plane, agentId: first.agentId })).toEqual([BRIEF])
  } finally {
    await original.stopAll()
  }
})
