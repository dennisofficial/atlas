import { afterEach, describe, expect, it } from 'bun:test'

import { EAgentStatus, EExecutionLocation, type ThreadId } from '@dltech/atlas-core'

import { agentTypeNamed, finished, loggedOfType, openSupervisor, settled } from './fixtures'
import type { OpenedSupervisor } from './fixtures'
import { append, endingFor } from './transferred-fixture'

const SHELL = 'bash "bun test"'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function openWithHeldChild() {
  const entry = await openSupervisor({
    agentTypes: [agentTypeNamed({ name: 'builder' })],
    runningShell: () => SHELL,
  })
  opened.push(entry)
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType: 'builder',
    brief: 'do the work',
    intent: 'the work',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  await settled()
  entry.runners.started[0]?.settle(finished())
  await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
  return { entry, agentId: outcome.snapshot.agentId }
}

const snapshotOf = (entry: OpenedSupervisor, agentId: ThreadId) =>
  entry.supervisor.list({ threadId: entry.parent }).find((one) => one.agentId === agentId)

describe('a held child at a relocation', () => {
  it('is paused by pauseChildren, so serve can resume it on the far side', async () => {
    const { entry, agentId } = await openWithHeldChild()
    expect(snapshotOf(entry, agentId)?.waitingOn).toBe(SHELL)

    const paused = await entry.supervisor.pauseChildren({ threadId: entry.parent })

    expect(paused).toEqual([agentId])
    expect(snapshotOf(entry, agentId)).toMatchObject({
      status: EAgentStatus.Paused,
      killedBy: undefined,
    })
    expect(snapshotOf(entry, agentId)?.waitingOn).toBeUndefined()
    const ended = await loggedOfType({
      harness: entry.harness,
      threadId: entry.parent,
      type: 'agent-ended',
    })
    expect(ended.map((one) => one.status)).toEqual([EAgentStatus.Paused])

    const resumed = await entry.supervisor.resume({ agentId, threadId: entry.parent })
    expect(resumed.ok).toBe(true)
    expect(entry.runners.resumed).toEqual([agentId])
  })

  it('is stopped for the move and resumed over its log by relocateChildren', async () => {
    const { entry, agentId } = await openWithHeldChild()

    const relocated = await entry.supervisor.relocateChildren({
      threadId: entry.parent,
      location: EExecutionLocation.Docker,
    })

    expect(relocated).toEqual([agentId])
    expect(entry.runners.resumed).toEqual([agentId])
    expect(snapshotOf(entry, agentId)?.status).toBe(EAgentStatus.Running)
    const stored = await entry.harness.threads.find({ threadId: agentId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Docker)
  })

  it('takes the incoming log over its stale in-memory state when the family is transferred', async () => {
    const { entry, agentId } = await openWithHeldChild()
    await append(entry, entry.parent, [
      endingFor({ agentId, agentType: 'builder', status: EAgentStatus.Finished, turns: 9 }),
    ])

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })

    expect(snapshotOf(entry, agentId)).toMatchObject({ status: EAgentStatus.Finished, turns: 9 })
  })
})
