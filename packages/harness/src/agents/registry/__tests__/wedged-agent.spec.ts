import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EKilledBy,
  ERunFailureKind,
  toRunId,
  type ThreadId,
} from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../../../loop/turn-outcome'
import { TurnFault } from '../../../model/turn-fault'
import { failed, loggedOfType, openSupervisor, settled, type OpenedSupervisor } from './fixtures'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const exchangeFault = (): TurnOutcome => {
  const message =
    'the assembled prompt is one Atlas must not send — message 0: the exchange opens with an assistant message'
  return {
    status: ETurnStatus.Failed,
    runId: toRunId('run_fake'),
    message,
    cause: new TurnFault({ kind: ERunFailureKind.ExchangeFault, message }),
  }
}

async function openEnded(outcome: TurnOutcome) {
  const entry = await openSupervisor()
  opened.push(entry)
  const spawned = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType: 'builder',
    brief: 'do the work',
    intent: 'the work',
  })
  if (!spawned.ok) throw new Error(spawned.reason)
  await settled()
  const agentId = spawned.snapshot.agentId
  entry.runners.started[0]?.settle(outcome)
  await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
  return { entry, agentId }
}

const snapshotOf = (entry: OpenedSupervisor, agentId: ThreadId) =>
  entry.supervisor.list({ threadId: entry.parent }).find((one) => one.agentId === agentId)

const endingsOf = (entry: OpenedSupervisor) =>
  loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-ended' })

describe('a child whose turn fails on prompt assembly', () => {
  it('ends Failed, fault-killed, with exactly one ending recorded and queued', async () => {
    const { entry, agentId } = await openEnded(exchangeFault())

    const ended = snapshotOf(entry, agentId)
    expect(ended?.status).toBe(EAgentStatus.Failed)
    expect(ended?.failureKind).toBe(ERunFailureKind.ExchangeFault)
    const woken = await entry.supervisor.wake({ agentId })
    expect(woken.ok).toBe(false)
    expect(entry.runners.started).toHaveLength(1)
    expect(await endingsOf(entry)).toHaveLength(1)
    expect(entry.supervisor.threadsAwaitingNotice()).toEqual([entry.parent])
  })

  it('refuses a notice wake with the wedged reason and never restarts it', async () => {
    const { entry, agentId } = await openEnded(exchangeFault())

    const woken = await entry.supervisor.wake({ agentId })

    expect(woken.ok).toBe(false)
    if (woken.ok) return
    expect(woken.reason).toContain('spawn a fresh agent')
    expect(woken.reason).toContain('cannot repair')
    expect(woken.reason).not.toContain('stopped deliberately')
    expect(entry.runners.started).toHaveLength(1)
    expect(
      await loggedOfType({
        harness: entry.harness,
        threadId: entry.parent,
        type: 'agent-restarted',
      }),
    ).toHaveLength(0)
  })

  it('refuses a say with the wedged reason and appends nothing to its log', async () => {
    const { entry, agentId } = await openEnded(exchangeFault())
    const before = await entry.harness.log.readOwn({ threadId: agentId })

    const said = await entry.supervisor.say({
      agentId,
      threadId: entry.parent,
      text: 'try again',
    })

    expect(said.ok).toBe(false)
    if (said.ok) return
    expect(said.reason).toContain('spawn a fresh agent')
    expect(said.reason).toContain('cannot repair')
    expect(await entry.harness.log.readOwn({ threadId: agentId })).toHaveLength(before.length)
    expect(entry.runners.started).toHaveLength(1)
    expect(
      await loggedOfType({
        harness: entry.harness,
        threadId: entry.parent,
        type: 'agent-restarted',
      }),
    ).toHaveLength(0)
  })

  it('records no further ending however often it is woken or messaged', async () => {
    const { entry, agentId } = await openEnded(exchangeFault())

    for (let attempt = 0; attempt < 3; attempt++) {
      await entry.supervisor.wake({ agentId })
      await entry.supervisor.say({ agentId, threadId: entry.parent, text: 'again' })
    }
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(await endingsOf(entry)).toHaveLength(1)
    expect(entry.runners.started).toHaveLength(1)
  })

  it('is still stoppable: stop succeeds and runs no turn', async () => {
    const { entry, agentId } = await openEnded(exchangeFault())

    const stopped = await entry.supervisor.stop({
      agentId,
      threadId: entry.parent,
      by: EKilledBy.User,
    })

    expect(stopped.ok).toBe(true)
    expect(entry.runners.started).toHaveLength(1)
    expect(await endingsOf(entry)).toHaveLength(1)
  })

  it('refuses a resume with the wedged reason and never restarts it', async () => {
    const { entry, agentId } = await openEnded(exchangeFault())

    const resumed = await entry.supervisor.resume({ agentId, threadId: entry.parent })

    expect(resumed.ok).toBe(false)
    if (resumed.ok) return
    expect(resumed.reason).toContain('spawn a fresh agent')
    expect(resumed.reason).not.toContain('send a message')
    expect(entry.runners.started).toHaveLength(1)
    expect(
      await loggedOfType({
        harness: entry.harness,
        threadId: entry.parent,
        type: 'agent-restarted',
      }),
    ).toHaveLength(0)
  })
})

describe('a child that failed for any other reason', () => {
  it('stays unmarked and can still be woken', async () => {
    const { entry, agentId } = await openEnded(failed('the provider fell over'))

    expect(snapshotOf(entry, agentId)?.status).toBe(EAgentStatus.Failed)
    expect(snapshotOf(entry, agentId)?.killedBy).toBeUndefined()

    const woken = await entry.supervisor.wake({ agentId })

    expect(woken.ok).toBe(true)
    expect(entry.runners.started).toHaveLength(2)
  })
})
