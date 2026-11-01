import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentRestart,
  EAgentStatus,
  toCallId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import {
  activateTransferredChildren,
  adoptTransferredChildren,
} from '../adopt-transferred-children'
import { finished, type OpenedSupervisor } from './fixtures'
import { append, endingFor, openChild, openFamily, snapshotOf } from './transferred-fixture'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const cleanTail: readonly EventDraft[] = [
  {
    type: 'assistant-said',
    parts: [{ type: 'text', text: 'waiting on the build' }],
  },
]

const interruptedMidTool: readonly EventDraft[] = [
  {
    type: 'tool-called',
    callId: toCallId('call_read'),
    name: 'read_file',
    ordinal: 0,
  },
]

const activate = async (entry: OpenedSupervisor) => {
  await adoptTransferredChildren({
    agents: entry.supervisor,
    threadId: entry.parent,
  })
  return activateTransferredChildren({
    agents: entry.supervisor,
    log: entry.harness.log,
    threadId: entry.parent,
  })
}

const pausedChild = async (args: { entry: OpenedSupervisor; tail: readonly EventDraft[] }) => {
  const childId = await openChild({
    entry: args.entry,
    spawnedBy: args.entry.parent,
  })
  await append(args.entry, args.entry.parent, [
    endingFor({ agentId: childId, status: EAgentStatus.Paused }),
  ])
  await append(args.entry, childId, args.tail)
  return childId
}

const restartsOn = async (entry: OpenedSupervisor) =>
  (await entry.harness.log.readOwn({ threadId: entry.parent })).filter(
    (event) => event.type === 'agent-restarted',
  )

describe('activating a transferred child the move paused', () => {
  it('wakes a paused child whose own log ends cleanly, and reports its ending to the parent', async () => {
    const entry = await openFamily(opened)
    const childId = await pausedChild({ entry, tail: cleanTail })

    const resumed = await activate(entry)

    expect(resumed).toEqual([childId])
    expect(entry.runners.resumed).toEqual([])
    expect(entry.runners.started.map((run) => run.threadId)).toEqual([childId])
    expect(snapshotOf(entry, entry.parent, childId)?.status).toBe(EAgentStatus.Running)
    expect(await restartsOn(entry)).toEqual([
      expect.objectContaining({ agentId: childId, via: EAgentRestart.Wake }),
    ])

    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(snapshotOf(entry, entry.parent, childId)?.status).toBe(EAgentStatus.Finished)
    expect(
      entry.supervisor.pendingNotices({ threadId: entry.parent }).map((one) => one.agentId),
    ).toEqual([childId])
  })

  it('still resumes a paused child whose own log was cut mid-work', async () => {
    const entry = await openFamily(opened)
    const childId = await pausedChild({ entry, tail: interruptedMidTool })

    const resumed = await activate(entry)

    expect(resumed).toEqual([childId])
    expect(entry.runners.resumed).toEqual([childId])
    expect(await restartsOn(entry)).toEqual([
      expect.objectContaining({
        agentId: childId,
        via: EAgentRestart.Relocation,
      }),
    ])
  })

  it.each([EAgentStatus.Stopped, EAgentStatus.Finished, EAgentStatus.Failed])(
    'leaves a %s child with a clean log alone',
    async (status) => {
      const entry = await openFamily(opened)
      const childId = await openChild({ entry, spawnedBy: entry.parent })
      await append(entry, entry.parent, [endingFor({ agentId: childId, status })])
      await append(entry, childId, cleanTail)

      expect(await activate(entry)).toEqual([])
      expect(entry.runners.started).toEqual([])
      expect(entry.runners.resumed).toEqual([])
    },
  )

  it('fails loudly when the registry cannot wake a paused child that needs it', async () => {
    const entry = await openFamily(opened)
    const childId = await pausedChild({ entry, tail: cleanTail })
    await adoptTransferredChildren({
      agents: entry.supervisor,
      threadId: entry.parent,
    })

    const activating = activateTransferredChildren({
      agents: {
        hydrate: entry.supervisor.hydrate.bind(entry.supervisor),
        list: entry.supervisor.list.bind(entry.supervisor),
        resume: entry.supervisor.resume.bind(entry.supervisor),
      },
      log: entry.harness.log,
      threadId: entry.parent,
    })

    await expect(activating).rejects.toThrow(childId satisfies ThreadId)
  })
})
