import { afterEach, describe, expect, it } from 'bun:test'

import { EAgentStatus, EExecutionLocation, type ThreadId } from '@dltech/atlas-core'

import type { AgentSupervisor } from '../supervisor'
import {
  EHydration,
  EReachedPort,
  openRig,
  stoppedDockerTeammate,
  TEAMMATE,
  type Reached,
  type Rig,
} from './recovered-placement-fixture'

const opened: Rig[] = []

afterEach(async () => {
  for (const rig of opened.splice(0)) {
    await rig.harness.close()
    rig.temp.discard()
  }
})

async function open(): Promise<Rig> {
  const rig = await openRig()
  opened.push(rig)
  return rig
}

async function recoveredUnderActiveHostParent(args: {
  rig: Rig
  hydration: EHydration
}): Promise<{ agentId: ThreadId; restarted: AgentSupervisor }> {
  const { rig, hydration } = args
  const agentId = await stoppedDockerTeammate(rig)

  rig.bindPlacement()
  await rig.placement.activate({ threadId: rig.parent })
  expect(rig.placement.current()).toBe(EExecutionLocation.Host)
  expect(rig.placement.of(agentId)).toBeUndefined()

  const restarted = rig.supervisorOver({ hydration })
  await restarted.hydrate({ threadId: rig.parent })
  expect(restarted.list({ threadId: rig.parent })[0]?.status).toBe(EAgentStatus.Stopped)
  return { agentId, restarted }
}

const reachedBy = (rig: Rig, agentId: ThreadId): Reached[] =>
  rig.reached.filter((entry) => entry.threadId === agentId)

const dockerForBoth = (agentId: ThreadId): Reached[] => [
  { port: EReachedPort.Process, where: EExecutionLocation.Docker, threadId: agentId },
  { port: EReachedPort.Filesystem, where: EExecutionLocation.Docker, threadId: agentId },
]

describe('a teammate whose durable placement the live routing map has not loaded', () => {
  it('routes a resumed teammate to Docker under an active Host parent', async () => {
    const rig = await open()
    const { agentId, restarted } = await recoveredUnderActiveHostParent({
      rig,
      hydration: EHydration.Placement,
    })

    const resumed = await restarted.resume({ agentId, threadId: rig.parent })
    expect(resumed.ok).toBe(true)
    await restarted.whenChildrenSettled({ threadId: rig.parent })

    expect(reachedBy(rig, agentId)).toEqual(dockerForBoth(agentId))
  })

  it('routes a message to a recovered teammate to Docker', async () => {
    const rig = await open()
    const { agentId, restarted } = await recoveredUnderActiveHostParent({
      rig,
      hydration: EHydration.Placement,
    })

    const said = await restarted.say({ agentId, threadId: rig.parent, text: 'probe again' })
    expect(said.ok).toBe(true)
    await restarted.whenChildrenSettled({ threadId: rig.parent })

    expect(reachedBy(rig, agentId)).toEqual(dockerForBoth(agentId))
  })

  it('routes a notice-woken recovered teammate to Docker', async () => {
    const rig = await open()
    const { agentId, restarted } = await recoveredUnderActiveHostParent({
      rig,
      hydration: EHydration.Placement,
    })

    const woken = await restarted.wake({ agentId })
    expect(woken.ok).toBe(true)
    await restarted.whenChildrenSettled({ threadId: rig.parent })

    expect(reachedBy(rig, agentId)).toEqual(dockerForBoth(agentId))
  })

  it('routes a fresh spawn from a Docker parent to Docker while the active session is Host', async () => {
    const rig = await open()
    await rig.harness.threads.chooseExecutionLocation({
      threadId: rig.parent,
      location: EExecutionLocation.Docker,
    })
    rig.bindPlacement()
    const operator = (await rig.harness.threads.create({})).id
    await rig.placement.activate({ threadId: operator })
    expect(rig.placement.current()).toBe(EExecutionLocation.Host)
    const supervisor = rig.supervisorOver({ hydration: EHydration.Placement })

    const spawned = await supervisor.spawn({
      threadId: rig.parent,
      agentType: TEAMMATE.name,
      brief: 'probe the environment',
      intent: 'probe',
    })
    if (!spawned.ok) throw new Error(spawned.reason)
    await supervisor.whenChildrenSettled({ threadId: rig.parent })

    expect(reachedBy(rig, spawned.snapshot.agentId)).toEqual(dockerForBoth(spawned.snapshot.agentId))
  })

  it('routes to the Host parent when nothing hydrates the child, which is the regression', async () => {
    const rig = await open()
    const { agentId, restarted } = await recoveredUnderActiveHostParent({
      rig,
      hydration: EHydration.Absent,
    })

    await restarted.resume({ agentId, threadId: rig.parent })
    await restarted.whenChildrenSettled({ threadId: rig.parent })

    expect(reachedBy(rig, agentId).map((entry) => entry.where)).toEqual([
      EExecutionLocation.Host,
      EExecutionLocation.Host,
    ])
  })

  it('fails the child instead of running it on a guessed placement when the load fails', async () => {
    const rig = await open()
    const { agentId, restarted } = await recoveredUnderActiveHostParent({
      rig,
      hydration: EHydration.Rejecting,
    })

    const resumed = await restarted.resume({ agentId, threadId: rig.parent })
    expect(resumed.ok).toBe(true)
    await restarted.whenChildrenSettled({ threadId: rig.parent })

    expect(restarted.list({ threadId: rig.parent })[0]?.status).toBe(EAgentStatus.Failed)
    expect(rig.reached).toEqual([])
    expect(rig.modelCalls()).toBe(0)
  })
})
