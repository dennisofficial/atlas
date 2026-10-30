import { afterEach, describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'

import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, finished, openSupervisor, type OpenedSupervisor } from './fixtures'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function openWithEnding(): Promise<{ entry: OpenedSupervisor; agentId: ThreadId }> {
  const entry = await openSupervisor({ agentTypes: [agentTypeNamed({ name: 'explore' })] })
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

const deliveredAtOf = ({
  supervisor,
  entry,
  agentId,
}: {
  supervisor: AgentSupervisor
  entry: OpenedSupervisor
  agentId: ThreadId
}): string | undefined =>
  supervisor.list({ threadId: entry.parent }).find((one) => one.agentId === agentId)?.deliveredAt

async function deliverFromLog({
  supervisor,
  entry,
}: {
  supervisor: AgentSupervisor
  entry: OpenedSupervisor
}): Promise<void> {
  const batch = supervisor.prepareNotifications({ threadId: entry.parent })
  await entry.harness.log.append({
    threadId: entry.parent,
    runId: entry.harness.ids.nextRunId(),
    drafts: batch.drafts,
  })
  batch.acknowledge()
}

describe('a finished child recovered from the log', () => {
  it('carries its delivery when its ending was already delivered', async () => {
    const { entry, agentId } = await openWithEnding()
    await deliverFromLog({ supervisor: entry.supervisor, entry })

    const fresh = restarted(entry)
    await fresh.hydrate({ threadId: entry.parent })

    expect(deliveredAtOf({ supervisor: fresh, entry, agentId })).toBeDefined()
  })

  it('carries its delivery after a transfer revises it', async () => {
    const { entry, agentId } = await openWithEnding()
    await deliverFromLog({ supervisor: entry.supervisor, entry })

    const fresh = restarted(entry)
    await fresh.hydrate({ threadId: entry.parent })
    await fresh.hydrateTransferred({ threadId: entry.parent })

    expect(deliveredAtOf({ supervisor: fresh, entry, agentId })).toBeDefined()
  })

  it('is delivered only once its owed ending is handed to the parent', async () => {
    const { entry, agentId } = await openWithEnding()

    const fresh = restarted(entry)
    await fresh.hydrate({ threadId: entry.parent })
    expect(deliveredAtOf({ supervisor: fresh, entry, agentId })).toBeUndefined()

    await deliverFromLog({ supervisor: fresh, entry })

    expect(deliveredAtOf({ supervisor: fresh, entry, agentId })).toBeDefined()
  })

  it('is delivered once an owed ending is handed over after a transfer', async () => {
    const { entry, agentId } = await openWithEnding()

    const fresh = restarted(entry)
    await fresh.hydrate({ threadId: entry.parent })
    await fresh.hydrateTransferred({ threadId: entry.parent })
    expect(deliveredAtOf({ supervisor: fresh, entry, agentId })).toBeUndefined()

    await deliverFromLog({ supervisor: fresh, entry })

    expect(deliveredAtOf({ supervisor: fresh, entry, agentId })).toBeDefined()
  })
})
