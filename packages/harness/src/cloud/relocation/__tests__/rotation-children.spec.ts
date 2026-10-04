import { afterEach, describe, expect, it } from 'bun:test'
import { EAgentRestart, EAgentStatus, EKilledBy, toCallId } from '@dltech/atlas-core'

import { activateTransferredChildren, adoptTransferredChildren } from '../adopt-transferred-children'
import { finished, type OpenedSupervisor } from '../../../agents/registry/__tests__/fixtures'
import { append, endingFor, openChild, openFamily } from '../../../agents/registry/__tests__/transferred-fixture'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    for (const run of entry.runners.started) run.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
    await entry.close()
  }
})

describe('explicit transferred queued-child obligations', () => {
  it('uses the registry wake seam for a Finished child with durable queued input without writing another message', async () => {
    const entry = await openFamily(opened)
    const child = await openChild({ entry, spawnedBy: entry.parent })
    await append(entry, child, [
      { type: 'assistant-said', parts: [{ type: 'text', text: 'first job complete' }] },
      { type: 'user-said', text: 'queued follow-up' },
    ])
    await append(entry, entry.parent, [endingFor({ agentId: child, status: EAgentStatus.Finished })])
    const before = await entry.harness.log.readOwn({ threadId: child })
    await adoptTransferredChildren({ agents: entry.supervisor, threadId: entry.parent })
    const started = await activateTransferredChildren({
      agents: entry.supervisor, log: entry.harness.log, threadId: entry.parent, resumeChildren: [child],
    })
    expect(started).toEqual([child])
    expect(entry.runners.started.map((run) => run.threadId)).toEqual([child])
    expect(entry.runners.resumed).toEqual([])
    expect(await entry.harness.log.readOwn({ threadId: child })).toEqual(before)
    expect((await entry.harness.log.readOwn({ threadId: entry.parent })).at(-1)).toMatchObject({
      type: 'agent-restarted', agentId: child, via: EAgentRestart.Wake,
    })
  })

  it('does not force approval pauses, deliberate stops or unlisted Finished children', async () => {
    const entry = await openFamily(opened)
    const blocked = await openChild({ entry, spawnedBy: entry.parent })
    const stopped = await openChild({ entry, spawnedBy: entry.parent })
    const unlisted = await openChild({ entry, spawnedBy: entry.parent })
    await append(entry, blocked, [{ type: 'approval-requested', callId: toCallId('approval-call'), reason: 'approval' }])
    await append(entry, stopped, [{ type: 'user-said', text: 'queued input' }])
    await append(entry, unlisted, [{ type: 'user-said', text: 'queued input' }])
    await append(entry, entry.parent, [
      endingFor({ agentId: blocked, status: EAgentStatus.Blocked }),
      endingFor({ agentId: stopped, status: EAgentStatus.Stopped, killedBy: EKilledBy.User }),
      endingFor({ agentId: unlisted, status: EAgentStatus.Finished }),
    ])
    await adoptTransferredChildren({ agents: entry.supervisor, threadId: entry.parent })
    expect(await activateTransferredChildren({
      agents: entry.supervisor, log: entry.harness.log, threadId: entry.parent, resumeChildren: [blocked, stopped],
    })).toEqual([])
    expect(entry.runners.started).toEqual([])
  })
})
