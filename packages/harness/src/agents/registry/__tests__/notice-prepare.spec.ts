import { afterEach, describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'

import { buildHarness } from '../../../loop/build-harness'
import { createTempHome } from '../../../loop/__tests__/temp-home'
import { scriptedModel } from '../../../model/testing/scripted-model'
import { TEAMMATE_AGENT_TYPE } from '../../types'
import { AgentSupervisor } from '../supervisor'
import {
  agentTypeNamed,
  fakeRunners,
  finished,
  loggedOfType,
  openSupervisor,
  settled,
  type OpenedSupervisor,
} from './fixtures'

const TEAMMATE = agentTypeNamed({ name: TEAMMATE_AGENT_TYPE })

const opened: OpenedSupervisor[] = []

async function open(): Promise<OpenedSupervisor> {
  const entry = await openSupervisor({ agentTypes: [agentTypeNamed({ name: 'explore' }), TEAMMATE] })
  opened.push(entry)
  return entry
}

async function openWithLiveWork(): Promise<OpenedSupervisor> {
  const entry = await openSupervisor({
    agentTypes: [agentTypeNamed({ name: 'explore' }), TEAMMATE],
    hasLiveWork: () => true,
  })
  opened.push(entry)
  return entry
}

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function spawnEnded(
  entry: OpenedSupervisor,
  agentType = 'explore',
): Promise<ThreadId> {
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType,
    brief: 'look',
    intent: 'looking',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

const deliveredOf = (entry: OpenedSupervisor, agentId: ThreadId): string | undefined =>
  entry.supervisor.list({ threadId: entry.parent }).find((one) => one.agentId === agentId)
    ?.deliveredAt

describe('preparing agent notices without acknowledging', () => {
  it('prepares twice before acknowledging: a failed append loses nothing', async () => {
    const entry = await open()
    await spawnEnded(entry)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const first = entry.supervisor.prepareNotifications({ threadId: entry.parent })
    const second = entry.supervisor.prepareNotifications({ threadId: entry.parent })

    expect(first.drafts).toEqual([])
    expect(first.wakesTurn).toBe(true)
    expect(second.wakesTurn).toBe(true)
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(1)

    first.acknowledge()
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(0)
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(false)
    expect(await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-ended' })).toHaveLength(1)
  })

  it('acknowledges exactly once: a second ack removes nothing more', async () => {
    const entry = await open()
    await spawnEnded(entry)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const batch = entry.supervisor.prepareNotifications({ threadId: entry.parent })
    await spawnEnded(entry)
    entry.runners.started[1]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    batch.acknowledge()
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(1)

    batch.acknowledge()
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(1)
  })

  it('leaves a notice that arrived while the batch was being prepared', async () => {
    const entry = await open()
    await spawnEnded(entry)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const batch = entry.supervisor.prepareNotifications({ threadId: entry.parent })
    expect(batch.wakesTurn).toBe(true)

    const late = await spawnEnded(entry)
    entry.runners.started[1]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    batch.acknowledge()

    const remaining = entry.supervisor.pendingNotices({ threadId: entry.parent })
    expect(remaining.map((one) => one.agentId)).toEqual([late])
  })

  it('leaves an unacknowledged batch unstamped, so the ending is still owed', async () => {
    const entry = await open()
    const agentId = await spawnEnded(entry)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    entry.supervisor.prepareNotifications({ threadId: entry.parent })

    expect(deliveredOf(entry, agentId)).toBeUndefined()
  })

  it('stamps delivery on acknowledge, only while the child still sits at that ending', async () => {
    const entry = await open()
    const agentId = await spawnEnded(entry)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const batch = entry.supervisor.prepareNotifications({ threadId: entry.parent })

    const restarted = await entry.supervisor.say({ agentId, threadId: entry.parent, text: 'again' })
    expect(restarted.ok).toBe(true)
    entry.runners.started[1]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    batch.acknowledge()

    expect(deliveredOf(entry, agentId)).toBeUndefined()
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(1)
  })

  it('stamps a report never, because a report is not an ending', async () => {
    const entry = await open()
    const agentId = await spawnEnded(entry, TEAMMATE_AGENT_TYPE)
    await settled()

    await entry.supervisor.reportToParent({ threadId: agentId, text: 'an update' })
    const batch = entry.supervisor.prepareNotifications({ threadId: entry.parent })
    batch.acknowledge()

    expect(deliveredOf(entry, agentId)).toBeUndefined()
  })

  it('does not stamp a new ending that shares its timestamp with the acknowledged one', async () => {
    const temp = createTempHome()
    const harness = await buildHarness({ home: temp.home, model: scriptedModel({ script: [] }) })
    const runners = fakeRunners()
    const frozenClock = { now: () => '2026-01-01T00:00:00.000Z' }
    const supervisor = new AgentSupervisor({
      log: harness.log,
      threads: harness.threads,
      ids: harness.ids,
      clock: frozenClock,
      agentTypes: [agentTypeNamed({ name: 'explore' })],
      runners: runners.source,
      launchDirectory: '/launch',
    })
    const parent = (await harness.threads.create({})).id
    const deliveryOf = (agentId: ThreadId): string | undefined =>
      supervisor.list({ threadId: parent }).find((one) => one.agentId === agentId)?.deliveredAt

    const spawned = await supervisor.spawn({
      threadId: parent,
      agentType: 'explore',
      brief: 'look',
      intent: 'looking',
    })
    if (!spawned.ok) throw new Error(spawned.reason)
    const agentId = spawned.snapshot.agentId
    runners.started[0]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    const firstEndedAt = supervisor
      .list({ threadId: parent })
      .find((one) => one.agentId === agentId)?.endedAt

    const stale = supervisor.prepareNotifications({ threadId: parent })

    await supervisor.say({ agentId, threadId: parent, text: 'again' })
    runners.started[1]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    const secondEndedAt = supervisor
      .list({ threadId: parent })
      .find((one) => one.agentId === agentId)?.endedAt
    expect(secondEndedAt).toBe(firstEndedAt)

    const fresh = supervisor.prepareNotifications({ threadId: parent })
    expect(supervisor.pendingNotices({ threadId: parent })).toHaveLength(2)
    expect(fresh.wakesTurn).toBe(true)

    stale.acknowledge()

    expect(deliveryOf(agentId)).toBeUndefined()
    expect(supervisor.threadsWithPendingInput()).toEqual([parent])

    fresh.acknowledge()
    expect(deliveryOf(agentId)).toBeDefined()

    await harness.close()
    temp.discard()
  })
})

describe('enumerating threads with anything queued', () => {
  it('queues nothing for a teammate that pauses with live work of its own still running', async () => {
    const entry = await openWithLiveWork()
    await spawnEnded(entry, TEAMMATE_AGENT_TYPE)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(entry.supervisor.threadsAwaitingNotice()).toEqual([])
    expect(entry.supervisor.threadsWithPendingInput()).toEqual([])

    const drained = entry.supervisor.drainNotifications({ threadId: entry.parent })
    expect(drained.wakesTurn).toBe(false)
    expect(drained.drafts).toHaveLength(0)
  })

  it('relays a teammate ending with no live work left to wake it, like a sub-agent ending', async () => {
    const entry = await open()
    await spawnEnded(entry, TEAMMATE_AGENT_TYPE)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(entry.supervisor.threadsAwaitingNotice()).toEqual([entry.parent])

    const drained = entry.supervisor.drainNotifications({ threadId: entry.parent })
    expect(drained.wakesTurn).toBe(true)
    expect(drained.drafts).toEqual([])
    expect(await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-ended' })).toHaveLength(1)
  })
})
