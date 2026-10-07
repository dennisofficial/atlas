import { afterEach, describe, expect, it } from 'bun:test'

import type { ClockPort, ThreadId } from '@dltech/atlas-core'

import { createTempHome, type TempHome } from '../../../loop/__tests__/temp-home'
import { buildHarness, type AtlasHarness } from '../../../loop/build-harness'
import { scriptedModel } from '../../../model/testing/scripted-model'
import { TEAMMATE_AGENT_TYPE } from '../../types'
import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, failed, fakeRunners, finished, loggedOfType, type FakeRunners } from './fixtures'

const EXPLORE = agentTypeNamed({ name: 'explore' })
const TEAMMATE = agentTypeNamed({ name: TEAMMATE_AGENT_TYPE })

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

const tickingClock = (): ClockPort => {
  let ticks = 0
  return { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ticks++)).toISOString() }
}

type Opened = {
  harness: AtlasHarness
  runners: FakeRunners
  supervisor: AgentSupervisor
  clock: ClockPort
  parent: ThreadId
  other: ThreadId
}

async function open(): Promise<Opened> {
  const temp = createTempHome()
  const harness = await buildHarness({
    home: temp.home,
    model: scriptedModel({ script: [] }),
  })
  opened.push({ harness, temp })

  const runners = fakeRunners()
  const clock = tickingClock()

  return {
    harness,
    runners,
    clock,
    supervisor: new AgentSupervisor({
      log: harness.log,
      threads: harness.threads,
      ids: harness.ids,
      clock,
      agentTypes: [EXPLORE, TEAMMATE],
      runners: runners.source,
      launchDirectory: '/launch',
    }),
    parent: (await harness.threads.create({})).id,
    other: (await harness.threads.create({})).id,
  }
}

const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function spawnUnder({
  supervisor,
  threadId,
  agentType = 'explore',
}: {
  supervisor: AgentSupervisor
  threadId: ThreadId
  agentType?: string | undefined
}): Promise<ThreadId> {
  const outcome = await supervisor.spawn({
    threadId,
    agentType,
    brief: 'look',
    intent: 'looking',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

const deliveryOf = ({
  supervisor,
  threadId,
  agentId,
}: {
  supervisor: AgentSupervisor
  threadId: ThreadId
  agentId: ThreadId
}): string | undefined =>
  supervisor.list({ threadId }).find((one) => one.agentId === agentId)?.deliveredAt

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

describe('when a finished child counts as delivered', () => {
  it('leaves a child whose notice nobody has read carrying no delivery', async () => {
    const { runners, supervisor, parent } = await open()
    const agentId = await spawnUnder({ supervisor, threadId: parent })

    runners.started[0]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    expect(supervisor.pendingNotices({ threadId: parent })).toHaveLength(1)
    expect(deliveryOf({ supervisor, threadId: parent, agentId })).toBeUndefined()
  })

  it('hands the parent the provider error a failed child died on', async () => {
    const { harness, runners, supervisor, parent } = await open()
    await spawnUnder({ supervisor, threadId: parent })

    runners.started[0]?.settle(failed('provider inference.net returned 402: credit exhausted'))
    await supervisor.whenChildrenSettled({ threadId: parent })

    const [ending] = await loggedOfType({ harness, threadId: parent, type: 'agent-ended' })
    expect(ending?.failureCause).toBe('provider inference.net returned 402: credit exhausted')
  })

  it('stamps the child when its parent drains the notice', async () => {
    const { runners, supervisor, clock, parent } = await open()
    const agentId = await spawnUnder({ supervisor, threadId: parent })

    runners.started[0]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    const drafts = supervisor.drainNotifications({ threadId: parent })
    const next = clock.now()

    expect(drafts.wakesTurn).toBe(true)
    const delivered = deliveryOf({ supervisor, threadId: parent, agentId })
    expect(delivered).toBeDefined()
    expect(delivered !== undefined && delivered < next).toBe(true)
  })

  it('leaves a child alone when a different thread drains', async () => {
    const { runners, supervisor, parent, other } = await open()
    const agentId = await spawnUnder({ supervisor, threadId: parent })
    await spawnUnder({ supervisor, threadId: other })

    runners.started[0]?.settle(finished())
    runners.started[1]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    supervisor.drainNotifications({ threadId: other })

    expect(deliveryOf({ supervisor, threadId: parent, agentId })).toBeUndefined()
  })

  it('leaves a forgotten notice undelivered, because forgetting is a discard', async () => {
    const { runners, supervisor, parent } = await open()
    const agentId = await spawnUnder({ supervisor, threadId: parent })

    runners.started[0]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    supervisor.forgetNotices({ threadId: parent })

    expect(supervisor.pendingNotices({ threadId: parent })).toHaveLength(0)
    expect(deliveryOf({ supervisor, threadId: parent, agentId })).toBeUndefined()
  })

  it('keeps the first delivery when the thread drains again', async () => {
    const { runners, supervisor, parent } = await open()
    const agentId = await spawnUnder({ supervisor, threadId: parent })

    runners.started[0]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    supervisor.drainNotifications({ threadId: parent })
    const first = deliveryOf({ supervisor, threadId: parent, agentId })

    supervisor.drainNotifications({ threadId: parent })

    expect(deliveryOf({ supervisor, threadId: parent, agentId })).toBe(first)
  })

  it('announces the stamp so a sidebar re-reads the roster', async () => {
    const { runners, supervisor, parent } = await open()
    await spawnUnder({ supervisor, threadId: parent })

    runners.started[0]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    let changes = 0
    supervisor.onChange(() => {
      changes += 1
    })
    const before = supervisor.list({ threadId: parent })

    supervisor.drainNotifications({ threadId: parent })

    expect(changes).toBe(1)
    expect(supervisor.list({ threadId: parent })).not.toBe(before)
  })

  it('drops the delivery when the child is put back to work', async () => {
    const { runners, supervisor, parent } = await open()
    const agentId = await spawnUnder({ supervisor, threadId: parent })

    runners.started[0]?.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })
    supervisor.drainNotifications({ threadId: parent })

    await supervisor.say({ agentId, threadId: parent, text: 'keep going' })

    expect(deliveryOf({ supervisor, threadId: parent, agentId })).toBeUndefined()
  })

  it('stamps nothing for a teammate report, because a report is not an ending', async () => {
    const { supervisor, parent } = await open()
    const agentId = await spawnUnder({ supervisor, threadId: parent, agentType: TEAMMATE_AGENT_TYPE })
    await settle()

    await supervisor.reportToParent({ threadId: agentId, text: 'an update' })
    supervisor.drainNotifications({ threadId: parent })

    expect(deliveryOf({ supervisor, threadId: parent, agentId })).toBeUndefined()
  })
})
