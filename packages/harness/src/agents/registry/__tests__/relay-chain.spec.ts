import { afterEach, describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'

import { TEAMMATE_AGENT_TYPE } from '../../types'
import {
  agentTypeNamed,
  failed,
  finished,
  loggedOfType,
  openSupervisor,
  settled,
  type OpenedSupervisor,
} from './fixtures'

const SHELL = 'bash "bun test"'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function openChain() {
  const holding = new Map<ThreadId, string>()
  const entry = await openSupervisor({
    agentTypes: [
      agentTypeNamed({ name: TEAMMATE_AGENT_TYPE }),
      agentTypeNamed({ name: 'builder' }),
    ],
    liveWork: (threadId) => holding.get(threadId),
  })
  opened.push(entry)

  const teammate = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType: TEAMMATE_AGENT_TYPE,
    brief: 'own the billing workstream',
    intent: 'billing workstream',
  })
  if (!teammate.ok) throw new Error(teammate.reason)
  await settled()

  const builder = await entry.supervisor.spawn({
    threadId: teammate.snapshot.agentId,
    agentType: 'builder',
    brief: 'build the migration',
    intent: 'the migration build',
  })
  if (!builder.ok) throw new Error(builder.reason)
  await settled()

  return { entry, holding, teammate: teammate.snapshot.agentId, builder: builder.snapshot.agentId }
}

describe('a sub-agent holding a shell under a teammate', () => {
  it('keeps the whole chain quiet until the shell clears, then wakes each level in turn', async () => {
    const { entry, holding, teammate, builder } = await openChain()
    const { supervisor, runners, parent, harness } = entry

    holding.set(builder, SHELL)
    runners.started[1]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: teammate })

    expect(supervisor.prepareNotifications({ threadId: teammate }).wakesTurn).toBe(false)
    const builderEnded = await loggedOfType({ harness, threadId: teammate, type: 'agent-ended' })
    expect(builderEnded).toHaveLength(1)
    expect(builderEnded[0]?.relayed).toBe(false)
    expect(builderEnded[0]?.waitingOn).toBe(SHELL)

    runners.started[0]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    expect(supervisor.prepareNotifications({ threadId: parent }).wakesTurn).toBe(false)
    const teammateQuiet = await loggedOfType({ harness, threadId: parent, type: 'agent-ended' })
    expect(teammateQuiet).toHaveLength(1)
    expect(teammateQuiet[0]?.relayed).toBe(false)
    expect(teammateQuiet[0]?.waitingOn).toBe(`the migration build: ${SHELL}`)
    expect(
      supervisor.list({ threadId: parent }).find((one) => one.agentId === teammate)?.waitingOn,
    ).toBe(`the migration build: ${SHELL}`)

    holding.delete(builder)
    expect((await supervisor.wake({ agentId: builder })).ok).toBe(true)
    runners.started[2]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: teammate })

    expect(supervisor.prepareNotifications({ threadId: teammate }).wakesTurn).toBe(true)
    supervisor.drainNotifications({ threadId: teammate })

    expect((await supervisor.wake({ agentId: teammate })).ok).toBe(true)
    runners.started[3]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    expect(supervisor.prepareNotifications({ threadId: parent }).wakesTurn).toBe(true)
    const ended = await loggedOfType({ harness, threadId: parent, type: 'agent-ended' })
    expect(ended).toHaveLength(2)
    expect(ended[1]?.relayed).not.toBe(false)
    expect(
      supervisor.list({ threadId: parent }).find((one) => one.agentId === teammate)?.waitingOn,
    ).toBeUndefined()
  })

  it('still reaches the main agent when the teammate fails, whatever its sub-agent holds', async () => {
    const { entry, holding, teammate, builder } = await openChain()
    const { supervisor, runners, parent, harness } = entry

    holding.set(builder, SHELL)
    runners.started[1]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: teammate })
    runners.started[0]?.settle(failed('the migration crashed'))
    await supervisor.whenChildrenSettled({ threadId: parent })

    expect(supervisor.prepareNotifications({ threadId: parent }).wakesTurn).toBe(true)
    const ended = await loggedOfType({ harness, threadId: parent, type: 'agent-ended' })
    expect(ended).toHaveLength(1)
    expect(ended[0]?.relayed).not.toBe(false)
    expect(ended[0]?.waitingOn).toBeUndefined()
  })
})
