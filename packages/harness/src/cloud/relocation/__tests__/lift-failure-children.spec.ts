import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { CloudError } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { fakeAgentSnapshot } from './fake-agents'
import { ELiftStep, liftToCloud } from '../lift'
import { CLEAN_WORKSPACE, CLOUD_THREAD, fakeBridge } from './fixture'
import { CHILD, fakeLiftAgents, FOOTER_SELECTION, harness } from './lift-fixture'

describe('a lift that does not finish, with children in tow', () => {
  it('leaves the family on the host when the sandbox will not start — nothing ever flipped', async () => {
    useAtlasHome()
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity in iad1' }),
    })
    const test = harness({ agents, bridge })
    await test.localLog.append({
      threadId: CHILD,
      runId: toRunId('run_child'),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
    })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(agents.relocatedTo).toEqual([])
    expect(test.localThreads.chosenLocations).toEqual([])

    const childRow = await test.localThreads.find({ threadId: CHILD })
    expect(childRow?.executionLocation ?? EExecutionLocation.Host).toBe(EExecutionLocation.Host)
  })

  it('never flips the family when the transcript will not reach the sandbox', async () => {
    useAtlasHome()
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const bridge = fakeBridge({
      putTranscriptFails: new CloudError({ status: 500, message: 'the row would not take the tar' }),
    })
    const test = harness({ agents, bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.step).toBe(ELiftStep.Starting)
    expect(agents.relocatedTo).toEqual([])
    expect(test.located).toEqual([])
  })

  it('gives up on a turn that will not stop instead of hanging the move', async () => {
    useAtlasHome()
    const test = harness({
      midTurn: true,
      interruptDeadlineMs: 20,
      whenSettled: () => new Promise<void>(() => undefined),
    })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.step).toBe(ELiftStep.Interrupting)
    expect(lifted.detail).toContain('would not stop')
    expect(test.stops).toBe(0)
    expect(test.located).toEqual([])
  })

  it('pauses the parent turn instead of interrupting it when the caller hands a pause over', async () => {
    useAtlasHome()
    let pauses = 0
    const test = harness({
      midTurn: true,
      pause: () => {
        pauses += 1
      },
    })

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    expect(pauses).toBe(1)
    expect(test.interrupts).toBe(0)
  })

  it('completes the lift without gpg material when the capture itself throws', async () => {
    useAtlasHome()
    const test = harness({
      captureGpg: async () => {
        throw new Error('gpg fell over')
      },
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([
      { threadId: CLOUD_THREAD, workspace: CLEAN_WORKSPACE, model: FOOTER_SELECTION.ref },
    ])
    expect(test.bridge.attached).toHaveLength(1)
  })

  it('waits for the session to go quiet even when no turn is in flight', async () => {
    useAtlasHome()
    let release = (): void => undefined
    const test = harness({
      midTurn: false,
      whenSettled: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    })

    const lifting = liftToCloud(test.args)
    await Bun.sleep(10)
    expect(test.stops).toBe(0)
    expect(test.steps).toEqual([])

    release()
    const lifted = await lifting
    expect(lifted.ok).toBe(true)
    expect(test.interrupts).toBe(0)
  })

  it('says what stopLocal closed when pausing the children is what fails', async () => {
    useAtlasHome()
    const agents = fakeLiftAgents()
    agents.pauseChildren = async () => {
      throw new Error('the registry fell over')
    }
    const test = harness({ agents })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.step).toBe(ELiftStep.Starting)
    expect(lifted.stopped).toMatchObject({ shells: ['bun run dev'], services: ['api'] })
    expect(test.located).toEqual([])
  })

  it('leaves the family in docker when a lift from docker fails before the flip', async () => {
    useAtlasHome()
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity in iad1' }),
    })
    const test = harness({ agents, bridge })
    await test.localThreads.chooseExecutionLocation({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Docker,
    })
    await test.localLog.append({
      threadId: CHILD,
      runId: toRunId('run_child'),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
    })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(test.located).toEqual([])
    expect(test.localThreads.chosenLocations).toEqual([
      { threadId: CLOUD_THREAD, location: EExecutionLocation.Docker },
    ])
    expect(agents.relocatedTo).toEqual([])
  })
})
