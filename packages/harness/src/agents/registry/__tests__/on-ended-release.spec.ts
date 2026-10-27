import { afterEach, describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'

import { TEAMMATE_AGENT_TYPE } from '../../types'
import {
  agentTypeNamed,
  failed,
  finished,
  openSupervisor,
  settled,
  type OpenedSupervisor,
} from './fixtures'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function openReleasing() {
  const released: ThreadId[] = []
  const entry = await openSupervisor({
    agentTypes: [
      agentTypeNamed({ name: 'builder' }),
      agentTypeNamed({ name: TEAMMATE_AGENT_TYPE }),
    ],
    onChildEnded: (threadId) => released.push(threadId),
  })
  opened.push(entry)
  return { entry, released }
}

async function spawn(entry: OpenedSupervisor, agentType: string): Promise<ThreadId> {
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType,
    brief: 'do the work',
    intent: 'the work',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  await settled()
  return outcome.snapshot.agentId
}

describe('releasing what a child held when it ends', () => {
  it('does not release a teammate whose turn ended as bookkeeping', async () => {
    const { entry, released } = await openReleasing()
    await spawn(entry, TEAMMATE_AGENT_TYPE)

    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(released).toEqual([])
  })

  it('releases a teammate that failed, since its ending is relayed', async () => {
    const { entry, released } = await openReleasing()
    const agentId = await spawn(entry, TEAMMATE_AGENT_TYPE)

    entry.runners.started[0]?.settle(failed('crashed'))
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(released).toEqual([agentId])
  })

  it('releases a sub-agent that finished', async () => {
    const { entry, released } = await openReleasing()
    const agentId = await spawn(entry, 'builder')

    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(released).toEqual([agentId])
  })
})
