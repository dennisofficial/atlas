import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EKilledBy,
  toThreadId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { buildHarness, type AtlasHarness } from '../../../loop/build-harness'
import { createTempHome } from '../../../loop/__tests__/temp-home'
import { scriptedModel } from '../../../model/testing/scripted-model'
import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, fakeRunners, finished, interrupted, settled } from './fixtures'

type Opened = {
  harness: AtlasHarness
  supervisor: AgentSupervisor
  runners: ReturnType<typeof fakeRunners>
  parent: ThreadId
  close: () => Promise<void>
}

const open = async (): Promise<Opened> => {
  const temp = createTempHome()
  const harness = await buildHarness({
    home: temp.home,
    model: scriptedModel({ script: [] }),
  })
  const runners = fakeRunners()

  return {
    harness,
    runners,
    supervisor: new AgentSupervisor({
      log: harness.log,
      threads: harness.threads,
      ids: harness.ids,
      clock: harness.clock,
      agentTypes: [agentTypeNamed({ name: 'explore' }), agentTypeNamed({ name: 'teammate' })],
      runners: runners.source,
      launchDirectory: '/launch',
    }),
    parent: (await harness.threads.create({})).id,
    close: async () => {
      await harness.close()
      temp.discard()
    },
  }
}

const opened: Opened[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const spawnTeammate = async (entry: Opened): Promise<ThreadId> => {
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType: 'teammate',
    brief: 'own this workstream',
    intent: 'own this workstream',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

const appendAsParent = async (entry: Opened, drafts: readonly EventDraft[]): Promise<void> => {
  await entry.harness.log.append({
    threadId: entry.parent,
    runId: entry.harness.ids.nextRunId(),
    drafts,
  })
}

const reopenAfter = async (entry: Opened): Promise<AgentSupervisor> => {
  const runners = fakeRunners()
  const supervisor = new AgentSupervisor({
    log: entry.harness.log,
    threads: entry.harness.threads,
    ids: entry.harness.ids,
    clock: entry.harness.clock,
    agentTypes: [agentTypeNamed({ name: 'explore' }), agentTypeNamed({ name: 'teammate' })],
    runners: runners.source,
    launchDirectory: '/launch',
  })
  await supervisor.hydrate({ threadId: entry.parent })
  return supervisor
}

describe('a stopped teammate across a simulated move', () => {
  it('stays stopped when the parent log carries its ending and nothing else', async () => {
    const first = await open()
    opened.push(first)
    const teammateId = await spawnTeammate(first)
    first.supervisor.stop({ agentId: teammateId, threadId: first.parent, by: EKilledBy.User })
    first.runners.started[0]?.settle(interrupted())
    await settled()

    await appendAsParent(first, first.supervisor.drainNotifications({ threadId: first.parent }))
    await first.supervisor.closeAll()

    const second = await reopenAfter(first)
    const snapshot = second.list({ threadId: first.parent })[0]
    expect(snapshot?.status).toBe(EAgentStatus.Stopped)
    expect(snapshot?.killedBy).toBe(EKilledBy.User)
  })
})

describe('resuming a terminal agent', () => {
  it('drops a resume for a finished agent instead of stepping it again', async () => {
    const entry = await open()
    opened.push(entry)
    const teammateId = await spawnTeammate(entry)
    entry.runners.started[0]?.settle(finished())
    await settled()

    const outcome = await entry.supervisor.resume({
      agentId: teammateId,
      threadId: entry.parent,
    })

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toContain('finished')
    expect(entry.runners.resumed).toEqual([])
    expect(entry.runners.started).toHaveLength(1)
    expect(entry.supervisor.list({ threadId: entry.parent })[0]?.status).toBe(
      EAgentStatus.Finished,
    )
  })

  it('drops a resume for a teammate the user stopped, without un-ending it', async () => {
    const entry = await open()
    opened.push(entry)
    const teammateId = await spawnTeammate(entry)
    entry.supervisor.stop({ agentId: teammateId, threadId: entry.parent, by: EKilledBy.User })
    entry.runners.started[0]?.settle(interrupted())
    await settled()

    const outcome = await entry.supervisor.resume({
      agentId: teammateId,
      threadId: entry.parent,
    })

    expect(outcome.ok).toBe(false)
    expect(entry.runners.resumed).toEqual([])
    const snapshot = entry.supervisor.list({ threadId: entry.parent })[0]
    expect(snapshot?.status).toBe(EAgentStatus.Stopped)
    expect(snapshot?.killedBy).toBe(EKilledBy.User)
  })

  it('drops a resume replayed after the move against a teammate whose ending traveled', async () => {
    const first = await open()
    opened.push(first)
    const teammateId = await spawnTeammate(first)
    first.supervisor.stop({ agentId: teammateId, threadId: first.parent, by: EKilledBy.User })
    first.runners.started[0]?.settle(interrupted())
    await settled()
    await appendAsParent(first, first.supervisor.drainNotifications({ threadId: first.parent }))
    await first.supervisor.closeAll()

    const second = await reopenAfter(first)
    const outcome = await second.resume({ agentId: teammateId, threadId: first.parent })

    expect(outcome.ok).toBe(false)
    expect(second.list({ threadId: first.parent })[0]?.status).toBe(EAgentStatus.Stopped)

    const ended = (await first.harness.log.readOwn({ threadId: first.parent })).filter(
      (event) => event.type === 'agent-ended' && event.agentId === teammateId,
    )
    expect(ended).toHaveLength(1)
  })

  it('still resumes a child that failed, which is what agent_resume is for', async () => {
    const entry = await open()
    opened.push(entry)
    const teammateId = await spawnTeammate(entry)
    entry.runners.started[0]?.fail(new Error('the model gateway dropped'))
    await settled()

    const outcome = await entry.supervisor.resume({
      agentId: teammateId,
      threadId: entry.parent,
    })

    expect(outcome.ok).toBe(true)
    expect(entry.runners.resumed).toEqual([teammateId])
  })

  it('still lets a fresh message restart a stopped teammate', async () => {
    const entry = await open()
    opened.push(entry)
    const teammateId = await spawnTeammate(entry)
    entry.supervisor.stop({ agentId: teammateId, threadId: entry.parent, by: EKilledBy.User })
    entry.runners.started[0]?.settle(interrupted())
    await settled()

    const outcome = await entry.supervisor.say({
      agentId: teammateId,
      threadId: entry.parent,
      text: 'pick the thread back up',
    })

    expect(outcome.ok).toBe(true)
    expect(entry.runners.started).toHaveLength(2)
  })

  it('drops a resume for a teammate another thread owns, naming the refusal', async () => {
    const entry = await open()
    opened.push(entry)

    const outcome = await entry.supervisor.resume({
      agentId: toThreadId('thread_stranger'),
      threadId: entry.parent,
    })

    expect(outcome.ok).toBe(false)
  })
})
