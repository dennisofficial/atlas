import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EExecutionLocation,
  EKilledBy,
  EServiceStatus,
  EStopAction,
  toThreadId,
  type ThreadId,
} from '@dltech/atlas-core'

import type { RelocateChildrenArgs } from '../../agents/registry/port'
import type { AgentSnapshot } from '../../agents/registry/snapshot'
import type { ServiceSnapshot } from '../../services/service-process'
import type { ServiceStopOutcome } from '../../services/service-registry'
import { relocateSession, type RelocatedSession } from '../relocate-session'
import {
  CountingIds,
  openStoreFixture,
  UnstaffedAgents,
  UnstaffedServices,
  type StoreFixture,
} from './harness'

class FakeServices extends UnstaffedServices {
  readonly stops: { serviceId: string; by: EKilledBy }[] = []
  readonly endingsAwaited: { ms: number }[] = []

  constructor(private readonly snapshots: readonly ServiceSnapshot[]) {
    super()
  }

  override awaitEndings(args: { ms: number }): Promise<number> {
    this.endingsAwaited.push(args)
    return Promise.resolve(0)
  }

  override list(): readonly ServiceSnapshot[] {
    return this.snapshots
  }

  override stop(args: { serviceId: string; by: EKilledBy }): ServiceStopOutcome {
    this.stops.push(args)
    const snapshot = this.snapshots.find((one) => one.serviceId === args.serviceId)
    if (snapshot === undefined) return { ok: false, reason: 'unknown service' }
    return { ok: true, snapshot, action: EStopAction.Term }
  }
}

class FakeAgents extends UnstaffedAgents {
  readonly relocations: RelocateChildrenArgs[] = []

  constructor(private readonly snapshots: readonly AgentSnapshot[]) {
    super()
  }

  override relocateChildren(args: RelocateChildrenArgs): Promise<readonly ThreadId[]> {
    this.relocations.push(args)
    return Promise.resolve(this.snapshots.map((one) => one.agentId))
  }

  override list(): readonly AgentSnapshot[] {
    return this.snapshots
  }
}

const service = (
  serviceId: string,
  status: ServiceSnapshot['status'],
): ServiceSnapshot => ({
  serviceId,
  command: 'bun dev',
  description: `${serviceId} description`,
  status,
  logPath: `/tmp/${serviceId}.log`,
  startedAt: '2026-09-15T00:00:00.000Z',
})

const childSnapshot = (agentId: ThreadId, spawnedBy: ThreadId): AgentSnapshot => ({
  agentId,
  spawnedBy,
  agentType: 'explore',
  intent: 'a look around',
  status: EAgentStatus.Finished,
  turns: 2,
  toolCalls: 5,
  lastTool: undefined,
  startedAt: '2026-09-15T00:00:00.000Z',
  endedAt: '2026-09-15T00:01:00.000Z',
})

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const open = async (): Promise<StoreFixture> => {
  const fixture = await openStoreFixture()
  fixtures.push(fixture)
  return fixture
}

describe('relocating a session to another execution location', () => {
  it('records the move on the thread, stops running services, and relocates the children', async () => {
    const fixture = await open()
    const parent = (await fixture.threads.create({})).id
    await fixture.threads.chooseExecutionLocation({
      threadId: parent,
      location: EExecutionLocation.Host,
    })

    const running = service('svc_1', EServiceStatus.Running)
    const exited = service('svc_2', EServiceStatus.Exited)
    const services = new FakeServices([running, exited])
    const agents = new FakeAgents([childSnapshot(toThreadId('brn_child-1'), parent)])

    const result = await relocateSession({
      threadId: parent,
      from: EExecutionLocation.Host,
      location: EExecutionLocation.Docker,
      log: fixture.log,
      ids: new CountingIds('relocate'),
      services,
      agents,
    })

    const events = await fixture.log.readOwn({ threadId: parent })
    const moved = events.filter((event) => event.type === 'location-changed')
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({
      from: EExecutionLocation.Host,
      to: EExecutionLocation.Docker,
    })

    expect(services.stops).toEqual([{ serviceId: 'svc_1', by: EKilledBy.ContainerSwitch }])
    expect(services.endingsAwaited).toHaveLength(1)
    expect(agents.relocations).toEqual([
      { threadId: parent, location: EExecutionLocation.Docker },
    ])

    expect(result).toEqual({
      stoppedServices: [running],
      relocatedAgents: [toThreadId('brn_child-1')],
      stillStopping: 0,
    } satisfies RelocatedSession)
  })

  it('records the origin it was handed, leaving the row to the caller', async () => {
    const fixture = await open()
    const parent = (await fixture.threads.create({})).id

    await relocateSession({
      threadId: parent,
      from: EExecutionLocation.Docker,
      location: EExecutionLocation.Host,
      log: fixture.log,
      ids: new CountingIds('relocate'),
      services: new FakeServices([]),
      agents: new FakeAgents([]),
    })

    const events = await fixture.log.readOwn({ threadId: parent })
    const moved = events.find((event) => event.type === 'location-changed')
    expect(moved).toMatchObject({
      from: EExecutionLocation.Docker,
      to: EExecutionLocation.Host,
    })

    const stored = await fixture.threads.find({ threadId: parent })
    expect(stored?.executionLocation).toBeUndefined()
  })
})
