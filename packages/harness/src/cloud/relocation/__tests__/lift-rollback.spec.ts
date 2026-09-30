import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toThreadId, type IdPort } from '@dltech/atlas-core'
import { CloudError } from '@dltech/atlas-harness'

import { fakeEventLog, fakeThreadStore, type FakeThreadStore } from './fake-backend'
import { useAtlasHome } from './descend-fixture'
import { fakeAgentSnapshot } from './fake-agents'
import { CapturingLog } from './fake-log'
import { ELiftStep, liftToCloud, type LiftArgs, type LiftFailure } from '../lift'
import { CHILD, fakeLiftAgents, harness } from './lift-fixture'
import { CLOUD_THREAD } from './fixture'

const throwingOnSecondFlip = (inner: FakeThreadStore): LiftArgs['localThreads'] => {
  let flips = 0
  return new Proxy(inner, {
    get: (target, property, receiver) => {
      if (property !== 'chooseExecutionLocation') return Reflect.get(target, property, receiver)
      return async (given: Parameters<FakeThreadStore['chooseExecutionLocation']>[0]) => {
        flips += 1
        if (flips > 1) throw new Error('the meta store is read-only right now')
        return target.chooseExecutionLocation(given)
      }
    },
  })
}

const failing = (lifted: { ok: boolean }): LiftFailure => {
  if (lifted.ok) throw new Error('expected the lift to fail')
  return lifted as LiftFailure
}

describe('a lift that fails after the ownership flip', () => {
  it('flips the ownership back when the open after attach throws', async () => {
    useAtlasHome()
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const test = harness({
      agents,
      open: async () => {
        throw new CloudError({ status: 404, message: 'Cannot GET /v1/threads/x/events/head' })
      },
    })
    await test.localThreads.createWithFirstEvents({
      threadId: CHILD,
      runId: test.args.ids.nextRunId(),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
      agent: { spawnedBy: CLOUD_THREAD, type: 'explore' },
    })

    const lifted = failing(await liftToCloud(test.args))

    expect(lifted.ok).toBe(false)
    expect(lifted.step).toBe(ELiftStep.Attaching)
    expect(lifted.detail).toContain('Cannot GET /v1/threads/x/events/head')
    expect(lifted.rolledBack).toBe(true)

    expect(test.located).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Host])
    expect(test.localThreads.chosenLocations).toEqual([
      { threadId: CLOUD_THREAD, location: EExecutionLocation.Cloud },
      { threadId: CHILD, location: EExecutionLocation.Cloud },
      { threadId: CLOUD_THREAD, location: EExecutionLocation.Host },
      { threadId: CHILD, location: EExecutionLocation.Host },
    ])
    expect(agents.relocatedTo).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Host])

    const row = await test.localThreads.find({ threadId: CLOUD_THREAD })
    expect(row?.executionLocation).toBe(EExecutionLocation.Host)
  })

  it('rolls a docker conversation back to docker, not to the host', async () => {
    useAtlasHome()
    const test = harness({
      open: async () => {
        throw new Error('the cloud conversation would not open')
      },
    })
    await test.localThreads.chooseExecutionLocation({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Docker,
    })

    const lifted = failing(await liftToCloud(test.args))

    expect(lifted.rolledBack).toBe(true)
    expect(test.located.at(-1)).toBe(EExecutionLocation.Docker)
    expect(test.localThreads.chosenLocations.at(-1)).toEqual({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Docker,
    })
  })

  it('still answers the attach error when the rollback itself throws', async () => {
    useAtlasHome()
    const logPort = new CapturingLog()
    const inner = fakeThreadStore({ log: fakeEventLog(), existing: [CLOUD_THREAD] })
    const test = harness({
      localThreads: throwingOnSecondFlip(inner),
      logPort,
      open: async () => {
        throw new CloudError({ status: 404, message: 'Cannot GET /v1/threads/x/events/head' })
      },
    })

    const lifted = failing(await liftToCloud(test.args))

    expect(lifted.step).toBe(ELiftStep.Attaching)
    expect(lifted.detail).toContain('Cannot GET /v1/threads/x/events/head')
    expect(lifted.rolledBack).toBe(false)
    expect(test.located).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Host])

    const rollbackWarn = logPort.entries.find(
      (entry) => entry.source === 'cloud.lift' && entry.message.includes('rollback'),
    )
    expect(rollbackWarn?.error).toContain('the meta store is read-only right now')
  })

  it('flips back when the resume after attach fails, and leaves the sandbox to the boot reaper', async () => {
    useAtlasHome()
    const logPort = new CapturingLog()
    const ids: IdPort = {
      nextThreadId: () => toThreadId('unused'),
      nextRunId: () => {
        throw new Error('id minting is down')
      },
      nextEventId: () => {
        throw new Error('unused')
      },
      nextCallId: () => {
        throw new Error('unused')
      },
    }
    const test = harness({ ids, logPort })

    const lifted = failing(await liftToCloud(test.args))

    expect(lifted.step).toBe(ELiftStep.Attaching)
    expect(lifted.rolledBack).toBe(true)
    expect(test.located).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Host])
    expect(test.localThreads.chosenLocations.at(-1)).toEqual({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Host,
    })

    const sandboxNote = logPort.entries.find(
      (entry) => entry.source === 'cloud.lift' && entry.message.includes('sandbox'),
    )
    expect(sandboxNote).toBeDefined()
  })
})
