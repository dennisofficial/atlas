import { afterEach, describe, expect, it } from 'bun:test'

import { ENoticeStage, type ThreadId } from '@dltech/atlas-core'

import { TEAMMATE_AGENT_TYPE } from '../../types'
import { AgentSupervisor } from '../supervisor'
import {
  agentTypeNamed,
  finished,
  loggedOfType,
  openSupervisor,
  stageOf,
  type OpenedSupervisor,
} from './fixtures'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function openWithArrival(): Promise<{ entry: OpenedSupervisor; agentId: ThreadId }> {
  const entry = await openSupervisor({
    agentTypes: [
      agentTypeNamed({ name: 'explore' }),
      agentTypeNamed({ name: TEAMMATE_AGENT_TYPE }),
    ],
  })
  opened.push(entry)
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType: 'explore',
    brief: 'look',
    intent: 'looking',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  entry.runners.started[0]?.settle(finished())
  await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
  return { entry, agentId: outcome.snapshot.agentId }
}

const restarted = (entry: OpenedSupervisor): AgentSupervisor =>
  new AgentSupervisor({
    log: entry.harness.log,
    threads: entry.harness.threads,
    ids: entry.harness.ids,
    clock: entry.harness.clock,
    agentTypes: [agentTypeNamed({ name: 'explore' })],
    runners: entry.runners.source,
    launchDirectory: '/launch',
  })

describe('a child ending that arrived before a restart', () => {
  it('is delivered once from the log by a fresh registry', async () => {
    const { entry, agentId } = await openWithArrival()
    const fresh = restarted(entry)

    await fresh.hydrate({ threadId: entry.parent })

    expect(fresh.pendingNotices({ threadId: entry.parent }).map((one) => one.agentId)).toEqual([
      agentId,
    ])
    const batch = fresh.prepareNotifications({ threadId: entry.parent })
    expect(batch.wakesTurn).toBe(true)
    expect(batch.drafts).toEqual([
      expect.objectContaining({
        type: 'agent-ended',
        agentId,
        notice: { id: expect.any(String), stage: ENoticeStage.Delivered },
      }),
    ])
    await entry.harness.log.append({
      threadId: entry.parent,
      runId: entry.harness.ids.nextRunId(),
      drafts: batch.drafts,
    })
    batch.acknowledge()

    expect(fresh.prepareNotifications({ threadId: entry.parent }).drafts).toEqual([])
    const logged = await loggedOfType({
      harness: entry.harness,
      threadId: entry.parent,
      type: 'agent-ended',
    })
    expect(logged.map(stageOf)).toEqual([ENoticeStage.Arrived, ENoticeStage.Delivered])
  })

  it('is not queued again once its delivered row is in the log', async () => {
    const { entry } = await openWithArrival()
    const first = restarted(entry)
    await first.hydrate({ threadId: entry.parent })
    const batch = first.prepareNotifications({ threadId: entry.parent })
    await entry.harness.log.append({
      threadId: entry.parent,
      runId: entry.harness.ids.nextRunId(),
      drafts: batch.drafts,
    })
    batch.acknowledge()

    const second = restarted(entry)
    await second.hydrate({ threadId: entry.parent })

    expect(second.pendingNotices({ threadId: entry.parent })).toEqual([])
    expect(second.prepareNotifications({ threadId: entry.parent }).drafts).toEqual([])
  })

  it('is not queued twice when the registry hydrates again', async () => {
    const { entry } = await openWithArrival()
    const fresh = restarted(entry)

    await fresh.hydrate({ threadId: entry.parent })
    await fresh.hydrateTransferred({ threadId: entry.parent })

    expect(fresh.pendingNotices({ threadId: entry.parent })).toHaveLength(1)
    expect(fresh.prepareNotifications({ threadId: entry.parent }).drafts).toHaveLength(1)
  })
})
