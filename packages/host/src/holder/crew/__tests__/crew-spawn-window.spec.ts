import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { EAgentStart, toRunId } from '@dltech/atlas-core'

import { openChildren } from '../open-children'
import { spawnAgentIdOf } from '../spawn-key'
import {
  BRIEF,
  CALL,
  PARENT,
  SESSION,
  briefsOf,
  flush,
  ofType,
  rigOf,
  spawnInStep,
} from './spawn-step-rig'

describe('a host killed after its spawn was recorded and before it briefed the child', () => {
  it('opens the one child the record names, briefs it once and reports nothing lost', async () => {
    const { room, created, parent, plane } = await rigOf()
    const agentId = spawnAgentIdOf({ parentThreadId: PARENT, stepKey: `${CALL}.0` })
    await plane.createThread({ threadId: agentId, sessionId: SESSION })
    await parent.record.append({
      threadId: PARENT,
      runId: toRunId('run-spawn-window'),
      drafts: [
        {
          type: 'agent-spawned',
          agentId,
          agentType: 'general-purpose',
          intent: 'probe',
          mode: EAgentStart.Fresh,
          callId: CALL,
        },
        {
          type: 'fact-recorded',
          key: `${CALL}.0:spawned`,
          kind: 'agent-spawned',
          value: { agentId },
        },
      ],
    })
    const posted: string[] = []
    const notices = new Proxy(plane, {
      get: (target, property) => {
        const value = Reflect.get(target, property)
        if (property !== 'post') return typeof value === 'function' ? value.bind(target) : value
        return async (message: Parameters<ControlPlane['post']>[0]) => {
          posted.push(message.payload)
          return target.post(message)
        }
      },
    })

    const children = await openChildren({
      record: parent.record,
      plane: notices,
      sessionId: SESSION,
      threadId: PARENT,
    })
    expect(children).toEqual([])

    const snapshot = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    await flush()

    expect(snapshot.agentId).toBe(agentId)
    expect(created).toEqual([agentId])
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(1)
    expect(await briefsOf({ plane, agentId })).toEqual([BRIEF])
    expect(posted.filter((payload) => payload.includes('agent-ended'))).toEqual([])
  })
})
