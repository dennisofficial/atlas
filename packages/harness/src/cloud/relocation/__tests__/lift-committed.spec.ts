import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, EPlacementMovePhase, locationOfPlacement } from '@dltech/atlas-core'
import { CloudError, PlacementController } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { fakeAgentSnapshot } from './fake-agents'
import { CapturingLog } from './fake-log'
import { ELiftStep, liftToCloud } from '../lift'
import { CLOUD_THREAD } from './fixture'
import { CHILD, fakeLiftAgents, harness } from './lift-fixture'

const controllerOf = (test: ReturnType<typeof harness>): PlacementController => test.placement

describe('a lift that fails after the ownership commit', () => {
  it('keeps the cloud placement and the committed marker — recovery is re-attaching', async () => {
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

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return
    expect(lifted.step).toBe(ELiftStep.Attaching)
    expect(lifted.detail).toContain('Cannot GET /v1/threads/x/events/head')

    const controller = controllerOf(test)
    expect(controller.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
    const snapshot = controller.snapshot(CLOUD_THREAD)
    expect(snapshot?.move?.phase).toBe(EPlacementMovePhase.Committed)
    expect(snapshot?.move === null || snapshot === undefined ? undefined : locationOfPlacement(snapshot.move.to)).toBe(
      EExecutionLocation.Cloud,
    )
    expect((await test.localThreads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
    expect((await test.localThreads.find({ threadId: CHILD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
    expect(agents.relocatedTo).toEqual([EExecutionLocation.Cloud])
  })

  it('a fresh boot reconciles the committed marker to cloud without flipping anything back', async () => {
    useAtlasHome()
    const test = harness({
      open: async () => {
        throw new Error('the socket died the moment it opened')
      },
    })

    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(false)

    const rebuilt = new PlacementController(EExecutionLocation.Host)
    rebuilt.bind({ threads: test.localThreads, workspace: '/work', repo: '/work' })
    await rebuilt.activate({ threadId: CLOUD_THREAD })
    expect(rebuilt.current()).toBe(EExecutionLocation.Cloud)
    expect(rebuilt.snapshot(CLOUD_THREAD)?.move?.phase).toBe(EPlacementMovePhase.Committed)

    await rebuilt.recover({ threadId: CLOUD_THREAD, reconcile: async (record) => record.placement })
    expect(rebuilt.current()).toBe(EExecutionLocation.Cloud)
    expect(rebuilt.snapshot(CLOUD_THREAD)?.move).toBeNull()
  })

  it('keeps the failure’s log trail without a rollback entry', async () => {
    useAtlasHome()
    const logPort = new CapturingLog()
    const test = harness({
      logPort,
      open: async () => {
        throw new CloudError({ status: 404, message: 'Cannot GET /v1/threads/x/events/head' })
      },
    })

    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(false)

    expect(logPort.entries.some((entry) => entry.message.includes('rollback'))).toBe(false)
  })
})
