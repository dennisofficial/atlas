import { afterEach, describe, expect, it } from 'bun:test'

import { EAgentStatus, EKilledBy, toRunId, type ThreadId } from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../../../loop/turn-outcome'
import { waitingOfBlock } from '../../../model-recovery/waiting-of-block'
import { blockedError } from '../../../model-recovery/__tests__/block-fixtures'
import {
  agentTypeNamed,
  finished,
  loggedOfType,
  openSupervisor,
  settled,
  type OpenedSupervisor,
} from './fixtures'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const waitingOutcome = (agentId: ThreadId): TurnOutcome => ({
  status: ETurnStatus.WaitingForModel,
  runId: toRunId('run_fake'),
  waiting: waitingOfBlock({ error: blockedError(), threadId: agentId }),
})

async function openWaiting() {
  const ended: ThreadId[] = []
  const orphaned: ThreadId[] = []
  const shellsEnded: ThreadId[] = []
  const telemetry: string[] = []
  const entry = await openSupervisor({
    agentTypes: [agentTypeNamed({ name: 'builder' })],
    onChildEnded: (id) => ended.push(id),
    inheritOrphanedNotices: ({ from }) => orphaned.push(from),
    endShells: async ({ threadId }) => {
      shellsEnded.push(threadId)
    },
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
  const agentId = outcome.snapshot.agentId
  entry.runners.started[0]?.settle(waitingOutcome(agentId))
  await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
  return { entry, agentId, ended, orphaned, shellsEnded, telemetry }
}

const snapshotOf = (entry: OpenedSupervisor, agentId: ThreadId) =>
  entry.supervisor.list({ threadId: entry.parent }).find((one) => one.agentId === agentId)

describe('a child whose model is unavailable', () => {
  it('parks as WaitingForModel: episode stored, not stepping, not ended', async () => {
    const { entry, agentId } = await openWaiting()

    const parked = snapshotOf(entry, agentId)
    expect(parked?.status).toBe(EAgentStatus.WaitingForModel)
    expect(parked?.steppingSince).toBeUndefined()
    expect(parked?.endedAt).toBeUndefined()
    expect(parked?.waitingFor).toEqual(
      waitingOfBlock({ error: blockedError(), threadId: agentId }).episode,
    )
  })

  it('records no ending, inherits no orphans, kills no shells and notifies nobody', async () => {
    const { entry, agentId, ended, orphaned, shellsEnded } = await openWaiting()

    expect(
      await loggedOfType({
        harness: entry.harness,
        threadId: entry.parent,
        type: 'agent-ended',
      }),
    ).toHaveLength(0)
    expect(ended).toEqual([])
    expect(orphaned).toEqual([])
    expect(shellsEnded).toEqual([])
    expect(entry.supervisor.threadsAwaitingNotice()).toEqual([])
    expect(snapshotOf(entry, agentId)?.deliveredAt).toBeUndefined()
  })

  it('is not settled as a lost child', async () => {
    const { entry, agentId } = await openWaiting()

    const recovered = await entry.supervisor.recordLostAgents({
      threadId: entry.parent,
    })

    expect(recovered.settled).toEqual([])
    expect(snapshotOf(entry, agentId)?.status).toBe(EAgentStatus.WaitingForModel)
  })

  it('resumes on the same child id and log, clearing the stored episode', async () => {
    const { entry, agentId } = await openWaiting()

    const outcome = await entry.supervisor.resume({
      agentId,
      threadId: entry.parent,
    })

    expect(outcome.ok).toBe(true)
    const resumed = snapshotOf(entry, agentId)
    expect(resumed?.status).toBe(EAgentStatus.Running)
    expect(resumed?.steppingSince).toBeDefined()
    expect(resumed?.waitingFor).toBeUndefined()
    expect(entry.runners.resumed).toEqual([agentId])
    entry.runners.started.at(-1)?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
    expect(snapshotOf(entry, agentId)?.status).toBe(EAgentStatus.Finished)
  })

  it('still ends once, as Stopped, when the operator stops it', async () => {
    const { entry, agentId } = await openWaiting()

    await entry.supervisor.stop({
      agentId,
      threadId: entry.parent,
      by: EKilledBy.User,
    })
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const ended = snapshotOf(entry, agentId)
    expect(ended?.status).toBe(EAgentStatus.Stopped)
    expect(ended?.killedBy).toBe(EKilledBy.User)
    expect(ended?.endedAt).toBeDefined()
    expect(
      await loggedOfType({
        harness: entry.harness,
        threadId: entry.parent,
        type: 'agent-ended',
      }),
    ).toHaveLength(1)
  })
})
