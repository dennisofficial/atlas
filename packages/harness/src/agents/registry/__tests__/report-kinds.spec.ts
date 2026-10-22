import { afterEach, describe, expect, it } from 'bun:test'

import { EReportKind, type ThreadId } from '@dltech/atlas-core'

import { TEAMMATE_AGENT_TYPE } from '../../types'
import {
  agentTypeNamed,
  loggedOfType,
  openSupervisor,
  settled,
  type OpenedSupervisor,
} from './fixtures'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function openWithTeammate(): Promise<{ entry: OpenedSupervisor; teammate: ThreadId }> {
  const entry = await openSupervisor({
    agentTypes: [agentTypeNamed({ name: TEAMMATE_AGENT_TYPE })],
  })
  opened.push(entry)
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType: TEAMMATE_AGENT_TYPE,
    brief: 'own the billing workstream',
    intent: 'billing workstream',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  await settled()
  return { entry, teammate: outcome.snapshot.agentId }
}

describe('a typed teammate report', () => {
  it('journals a progress report with its kind and queues no notice', async () => {
    const { entry, teammate } = await openWithTeammate()

    const outcome = await entry.supervisor.reportToParent({
      threadId: teammate,
      text: 'still waiting on CI',
      kind: EReportKind.Progress,
    })

    expect(outcome.ok).toBe(true)
    const logged = await loggedOfType({
      harness: entry.harness,
      threadId: entry.parent,
      type: 'agent-reported',
    })
    expect(logged.map((event) => event.kind)).toEqual([EReportKind.Progress])
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(0)
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(false)
  })

  it.each([EReportKind.Done, EReportKind.Blocked, EReportKind.NeedsDecision])(
    'queues a waking notice for a %s report',
    async (kind) => {
      const { entry, teammate } = await openWithTeammate()

      await entry.supervisor.reportToParent({ threadId: teammate, text: 'a result', kind })

      const logged = await loggedOfType({
        harness: entry.harness,
        threadId: entry.parent,
        type: 'agent-reported',
      })
      expect(logged.map((event) => event.kind)).toEqual([kind])
      expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(true)
    },
  )
})
