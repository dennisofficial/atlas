import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentRestart,
  EAgentStatus,
  EKilledBy,
  toCallId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { activateTransferredChildren, adoptTransferredChildren } from '../../../cloud/relocation/adopt-transferred-children'
import { TEAMMATE_AGENT_TYPE } from '../../types'
import { finished, settled, type OpenedSupervisor } from './fixtures'
import { append, endingFor, openChild, openFamily, snapshotOf } from './transferred-fixture'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const open = (): Promise<OpenedSupervisor> => openFamily(opened)

const spawnEvents = async (entry: OpenedSupervisor, threadId: ThreadId) =>
  (await entry.harness.log.readOwn({ threadId })).filter((event) => event.type === 'agent-spawned')

describe('hydrating a family that arrived from another location', () => {
  it('replaces the counts, status and model the earlier hydration remembered', async () => {
    const entry = await open()
    const childId = await openChild({ entry, spawnedBy: entry.parent })
    await entry.supervisor.hydrate({ threadId: entry.parent })
    expect(snapshotOf(entry, entry.parent, childId)).toMatchObject({ turns: 0, endedAt: undefined })

    await append(entry, entry.parent, [endingFor({ agentId: childId, status: EAgentStatus.Finished })])
    await entry.harness.threads.chooseModel({
      threadId: childId,
      model: { ref: 'anthropic/claude-opus-5', effort: 'medium' },
    })
    await entry.supervisor.hydrate({ threadId: entry.parent })
    expect(snapshotOf(entry, entry.parent, childId)?.turns).toBe(0)

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })

    expect(snapshotOf(entry, entry.parent, childId)).toMatchObject({
      agentId: childId,
      status: EAgentStatus.Finished,
      turns: 3,
      toolCalls: 2,
      model: { id: 'anthropic', modelId: 'claude-opus-5' },
    })
    expect(snapshotOf(entry, entry.parent, childId)?.endedAt).toBeDefined()
  })

  it('writes nothing to the parent log, so no spawn is fabricated', async () => {
    const entry = await open()
    const childId = await openChild({ entry, spawnedBy: entry.parent })
    await entry.supervisor.hydrate({ threadId: entry.parent })
    const headBefore = await entry.harness.log.head({ threadId: entry.parent })

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })

    expect(await entry.harness.log.head({ threadId: entry.parent })).toBe(headBefore)
    expect((await spawnEvents(entry, entry.parent)).map((event) => event.agentId)).toEqual([childId])
  })

  it('adds a child that only the incoming log names, under its original id', async () => {
    const entry = await open()
    await entry.supervisor.hydrate({ threadId: entry.parent })
    const lateId = await openChild({ entry, spawnedBy: entry.parent })

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })

    expect(entry.supervisor.list({ threadId: entry.parent }).map((one) => one.agentId)).toEqual([lateId])
  })

  it('refreshes nested children from each owner log', async () => {
    const entry = await open()
    const childId = await openChild({ entry, spawnedBy: entry.parent, agentType: TEAMMATE_AGENT_TYPE })
    const nestedId = await openChild({ entry, spawnedBy: childId })
    await entry.supervisor.hydrate({ threadId: entry.parent })
    await entry.supervisor.hydrate({ threadId: childId })
    await append(entry, childId, [endingFor({ agentId: nestedId, status: EAgentStatus.Finished, turns: 7 })])

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })

    expect(snapshotOf(entry, childId, nestedId)).toMatchObject({
      spawnedBy: childId,
      status: EAgentStatus.Finished,
      turns: 7,
    })
  })

  it('drops the family notices queued before the move and keeps other threads untouched', async () => {
    const entry = await open()
    const second = (await entry.harness.threads.create({})).id
    const spawn = async (threadId: ThreadId) => {
      const outcome = await entry.supervisor.spawn({
        threadId,
        agentType: 'explore',
        brief: 'look around',
        intent: 'a look around',
      })
      if (!outcome.ok) throw new Error(outcome.reason)
      return outcome.snapshot.agentId
    }
    const mine = await spawn(entry.parent)
    const theirs = await spawn(second)
    for (const run of entry.runners.started) run.settle(finished())
    await settled()
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(1)
    await append(entry, entry.parent, [endingFor({ agentId: mine, status: EAgentStatus.Finished })])

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })

    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(0)
    expect(entry.supervisor.pendingNotices({ threadId: second }).map((one) => one.agentId)).toEqual([theirs])
    expect(snapshotOf(entry, second, theirs)?.status).toBe(EAgentStatus.Finished)
  })

  it('leaves a child this process is stepping right now alone', async () => {
    const entry = await open()
    const outcome = await entry.supervisor.spawn({
      threadId: entry.parent,
      agentType: 'explore',
      brief: 'look around',
      intent: 'a look around',
    })
    if (!outcome.ok) throw new Error(outcome.reason)
    const childId = outcome.snapshot.agentId

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })

    expect(snapshotOf(entry, entry.parent, childId)?.status).toBe(EAgentStatus.Running)
  })

  it('does not spawn anything when the helper falls back to a plain hydrate', async () => {
    const entry = await open()
    const childId = await openChild({ entry, spawnedBy: entry.parent })
    const hydrated: ThreadId[] = []

    await adoptTransferredChildren({
      agents: {
        hydrate: async ({ threadId }) => void hydrated.push(threadId),
        list: () => [],
        resume: entry.supervisor.resume.bind(entry.supervisor),
      },
      threadId: entry.parent,
    })

    expect(hydrated).toEqual([entry.parent])
    expect((await spawnEvents(entry, entry.parent)).map((event) => event.agentId)).toEqual([childId])
  })
})

describe('activating a transferred family', () => {
  const interruptedMidTool: readonly EventDraft[] = [
    { type: 'tool-called', callId: toCallId('call_read'), name: 'read_file', ordinal: 0 },
  ]

  const activate = async (entry: OpenedSupervisor) => {
    await adoptTransferredChildren({ agents: entry.supervisor, threadId: entry.parent })
    return activateTransferredChildren({
      agents: entry.supervisor,
      log: entry.harness.log,
      threadId: entry.parent,
    })
  }

  it('resumes sub-agents and teammates the source left unended or paused by the move', async () => {
    const entry = await open()
    const unended = await openChild({ entry, spawnedBy: entry.parent })
    const teammate = await openChild({ entry, spawnedBy: entry.parent, agentType: TEAMMATE_AGENT_TYPE })
    const paused = await openChild({ entry, spawnedBy: entry.parent })
    const switched = await openChild({ entry, spawnedBy: entry.parent })
    await append(entry, entry.parent, [
      endingFor({ agentId: paused, status: EAgentStatus.Stopped }),
      endingFor({ agentId: switched, status: EAgentStatus.Stopped, killedBy: EKilledBy.ContainerSwitch }),
    ])
    for (const id of [unended, teammate, paused, switched]) await append(entry, id, interruptedMidTool)

    const resumed = await activate(entry)

    expect([...resumed].sort()).toEqual([unended, teammate, paused, switched].sort())
    expect(entry.runners.resumed).toHaveLength(4)
  })

  it('keeps what the user or the source already ended ended, with its attribution', async () => {
    const entry = await open()
    const byUser = await openChild({ entry, spawnedBy: entry.parent, agentType: TEAMMATE_AGENT_TYPE })
    const done = await openChild({ entry, spawnedBy: entry.parent })
    const failed = await openChild({ entry, spawnedBy: entry.parent })
    await append(entry, entry.parent, [
      endingFor({ agentId: byUser, status: EAgentStatus.Stopped, killedBy: EKilledBy.User }),
      endingFor({ agentId: done, status: EAgentStatus.Finished }),
      endingFor({ agentId: failed, status: EAgentStatus.Failed }),
    ])
    for (const id of [byUser, done, failed]) await append(entry, id, interruptedMidTool)

    const resumed = await activate(entry)

    expect(resumed).toEqual([])
    expect(entry.runners.resumed).toEqual([])
    expect(snapshotOf(entry, entry.parent, byUser)).toMatchObject({
      status: EAgentStatus.Stopped,
      killedBy: EKilledBy.User,
    })
  })

  it('does not resume a child whose own log is not mid-work', async () => {
    const entry = await open()
    const idle = await openChild({ entry, spawnedBy: entry.parent })
    await append(entry, idle, [{ type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] }])

    expect(await activate(entry)).toEqual([])
  })

  it('records the resume as one relocation restart on the parent log and no new spawn', async () => {
    const entry = await open()
    const childId = await openChild({ entry, spawnedBy: entry.parent })
    await append(entry, childId, interruptedMidTool)

    await activate(entry)

    const restarts = (await entry.harness.log.readOwn({ threadId: entry.parent })).filter(
      (event) => event.type === 'agent-restarted',
    )
    expect(restarts).toHaveLength(1)
    expect(restarts[0]).toMatchObject({ agentId: childId, via: EAgentRestart.Relocation })
    expect(await spawnEvents(entry, entry.parent)).toHaveLength(1)
  })
})
