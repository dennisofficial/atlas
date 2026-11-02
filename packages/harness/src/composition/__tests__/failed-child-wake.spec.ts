import { afterEach, describe, expect, it } from 'bun:test'

import { EAgentStatus, type EventLogPort, type IdPort } from '@dltech/atlas-core'

import {
  agentTypeNamed,
  failed,
  fakeRunners,
  openSupervisor,
  settled,
  type OpenedSupervisor,
} from '../../agents/registry/__tests__/fixtures'
import { AgentSupervisor } from '../../agents/registry/supervisor'
import type { MessageIntake } from '../../intake'
import { createPendingQueues } from '../../pending'
import type { ServiceRegistryPort } from '../../services/service-registry'
import type { ShellRegistryPort } from '../../shells/shell-registry'
import { bindIntake } from '../intake-binding'

const BUILDER = agentTypeNamed({ name: 'builder' })

const idleShells = {
  listEverywhere: () => [],
  onNotice: () => () => undefined,
  pendingNotices: () => [],
  threadsAwaitingNotice: () => [],
  threadsWithPendingInput: () => [],
  drainNotifications: () => [],
} as unknown as ShellRegistryPort

const idleServices = {
  list: () => [],
  onNotice: () => () => undefined,
  pendingNotices: () => [],
  threadsAwaitingNotice: () => [],
  drainNotifications: () => [],
} as unknown as ServiceRegistryPort

const wired = async () => {
  const entry = await openSupervisor({ agentTypes: [BUILDER] })
  const runners = fakeRunners()
  const pending = createPendingQueues<never>()
  let intake: MessageIntake | undefined
  const supervisor = new AgentSupervisor({
    log: entry.harness.log,
    threads: entry.harness.threads,
    ids: entry.harness.ids,
    clock: entry.harness.clock,
    agentTypes: [BUILDER],
    runners: runners.source,
    launchDirectory: '/launch',
    input: () => intake,
    intake: { changed: () => intake?.changed(), prepare: (args) => intake!.prepare(args) },
  })
  const bound = bindIntake({
    pending,
    shells: idleShells,
    agents: supervisor,
    services: idleServices,
    log: {} as unknown as EventLogPort,
    ids: {} as unknown as IdPort,
    stopSandbox: async () => true,
  })
  intake = bound.intake
  return { entry, runners, supervisor, intake: bound.intake }
}

describe('a failed sub-agent with input still queued', () => {
  const opened: OpenedSupervisor[] = []
  const intakes: MessageIntake[] = []

  afterEach(async () => {
    for (const intake of intakes.splice(0)) intake.dispose()
    for (const entry of opened.splice(0)) await entry.close()
  })

  const failedWithQueuedSay = async () => {
    const setup = await wired()
    opened.push(setup.entry)
    intakes.push(setup.intake)
    const spawned = await setup.supervisor.spawn({
      threadId: setup.entry.parent,
      agentType: BUILDER.name,
      brief: 'build it',
      intent: 'build',
    })
    if (!spawned.ok) throw new Error(spawned.reason)
    const childId = spawned.snapshot.agentId
    const said = await setup.supervisor.say({
      agentId: childId,
      threadId: setup.entry.parent,
      text: 'also do the other thing',
    })
    expect(said.ok).toBe(true)
    const first = setup.runners.started[0]
    if (first === undefined) throw new Error('the spawn never started a child runner')
    first.settle(failed('provider rejected the request'))
    for (let turn = 0; turn < 10; turn += 1) await settled()
    await new Promise((resolve) => setTimeout(resolve, 1300))
    return { ...setup, childId }
  }

  it('is not woken again by its own pending input', async () => {
    const { runners, supervisor, entry } = await failedWithQueuedSay()

    expect(runners.started).toHaveLength(1)
    expect(supervisor.list({ threadId: entry.parent })[0]?.status).toBe(EAgentStatus.Failed)
  })

  it('is restarted by an explicit say from its parent', async () => {
    const { runners, supervisor, entry, childId } = await failedWithQueuedSay()

    const said = await supervisor.say({
      agentId: childId,
      threadId: entry.parent,
      text: 'try again',
    })
    expect(said.ok).toBe(true)
    for (let turn = 0; turn < 10; turn += 1) await settled()

    expect(runners.started).toHaveLength(2)
  })
})
