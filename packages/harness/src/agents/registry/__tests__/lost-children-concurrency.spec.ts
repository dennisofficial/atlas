import { afterEach, describe, expect, it } from 'bun:test'

import { toCallId, type EventDraft } from '@dltech/atlas-core'

import { openChildThread } from '../open-child'
import { agentTypeNamed, openSupervisor, type OpenedSupervisor } from './fixtures'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function crashedWithWork(): Promise<OpenedSupervisor> {
  const open = await openSupervisor()
  opened.push(open)

  const { threadId: agentId } = await openChildThread({
    threads: open.harness.threads,
    log: open.harness.log,
    ids: open.harness.ids,
    spawnedBy: open.parent,
    agentType: agentTypeNamed({ name: 'explore' }),
    brief: 'find the callers',
    intent: 'find the callers',
  })
  const drafts: EventDraft[] = [
    {
      type: 'assistant-said',
      parts: [{ type: 'text', text: 'looking' }],
    },
    { type: 'tool-called', callId: toCallId('call_read'), name: 'read_file', ordinal: 0 },
  ]
  await open.harness.log.append({
    threadId: agentId,
    runId: open.harness.ids.nextRunId(),
    drafts,
  })

  return open
}

describe('two callers settling the same lost child at once', () => {
  it('join the one settlement, so exactly one ending is ever written', async () => {
    const open = await crashedWithWork()

    const [first, second] = await Promise.all([
      open.supervisor.recordLostAgents({ threadId: open.parent }),
      open.supervisor.recordLostAgents({ threadId: open.parent }),
    ])

    expect(first.settled).toHaveLength(1)
    expect(second.settled).toEqual(first.settled)

    const endings = (await open.harness.log.read({ threadId: open.parent })).filter(
      (event) => event.type === 'agent-ended',
    )
    expect(endings).toHaveLength(1)
  })
})

describe('a settlement whose first read fails', () => {
  it('propagates the failure and retries the rebuild on the next call', async () => {
    const open = await crashedWithWork()

    const log = open.harness.log
    const readOwn = log.readOwn.bind(log)
    let failuresLeft = 1
    log.readOwn = async (args) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1
        throw new Error('read failed')
      }
      return readOwn(args)
    }

    await expect(open.supervisor.recordLostAgents({ threadId: open.parent })).rejects.toThrow(
      'read failed',
    )
    const retried = await open.supervisor.recordLostAgents({ threadId: open.parent })

    expect(retried.settled).toHaveLength(1)
    const endings = (await log.read({ threadId: open.parent })).filter(
      (event) => event.type === 'agent-ended',
    )
    expect(endings).toHaveLength(1)
  })
})
