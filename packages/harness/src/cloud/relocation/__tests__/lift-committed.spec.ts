import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, EPlacementMovePhase, locationOfPlacement } from '@dltech/atlas-core'
import { CloudError, PlacementController } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { fakeAgentSnapshot } from './fake-agents'
import { CapturingLog } from './fake-log'
import { EClientRequest } from '../../channel-wire'
import { liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { CHILD, fakeLiftAgents, harness } from './lift-fixture'
import { WORKSPACE_MANIFEST } from './workspace-fixture'

const controllerOf = (test: ReturnType<typeof harness>): PlacementController => test.placement

describe('a lift that fails after the ownership commit', () => {
  it('keeps the cloud placement and the committed marker while reporting the lift done with the failure as a warning', async () => {
    useAtlasHome()
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    agents.markChildrenRelocated = async () => {
      throw new CloudError({ status: 500, message: 'the roster would not follow' })
    }
    const test = harness({ agents })
    await test.localThreads.createWithFirstEvents({
      threadId: CHILD,
      runId: test.args.ids.nextRunId(),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
      agent: { spawnedBy: CLOUD_THREAD, type: 'explore' },
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    if (!lifted.ok) return
    expect(lifted.warning).toContain('the roster would not follow')
    expect(lifted.channel).toBe(test.bridge.channel)

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
    expect(agents.relocatedTo).toEqual([])
  })

  it('a fresh boot reconciles the committed marker to cloud without flipping anything back', async () => {
    useAtlasHome()
    const agents = fakeLiftAgents([fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })])
    agents.markChildrenRelocated = async () => {
      throw new Error('the roster would not follow')
    }
    const test = harness({ agents })

    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(true)

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
    const agents = fakeLiftAgents([fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })])
    agents.markChildrenRelocated = async () => {
      throw new CloudError({ status: 500, message: 'the roster would not follow' })
    }
    const test = harness({ logPort, agents })

    const lifted = await liftToCloud(test.args)
    expect(lifted.ok).toBe(true)

    expect(logPort.entries.some((entry) => entry.message.includes('rollback'))).toBe(false)
  })
})

describe('a lift whose cloud activation fails after the ownership commit', () => {
  const failingActivation = async (args: { midTurn: boolean; agents: ReturnType<typeof fakeLiftAgents> }) => {
    const bridge = fakeBridge()
    const attach = bridge.attach.bind(bridge)
    bridge.attach = (request) => {
      const attachment = attach(request)
      const ask = attachment.channel.request.bind(attachment.channel)
      attachment.channel.request = async (frame) => {
        if (frame.op === EClientRequest.ActivateSession) return { activated: false }
        return ask(frame)
      }
      return attachment
    }
    let sourceResumes = 0
    const test = harness({
      bridge,
      agents: args.agents,
      midTurn: args.midTurn,
      resumeSource: () => {
        sourceResumes += 1
      },
      captureWorkspaceArchive: async () => ({
        path: '/tmp/atlas-lift-workspace-x/workspace.tar.gz',
        manifest: WORKSPACE_MANIFEST,
        release: async () => undefined,
      }),
    })
    const lifted = await liftToCloud(test.args)
    return { test, lifted, sourceResumes: () => sourceResumes }
  }

  it('reports the lift as done with a warning, keeping the cloud placement and the committed marker', async () => {
    useAtlasHome()
    const { test, lifted } = await failingActivation({ midTurn: false, agents: fakeLiftAgents() })

    expect(lifted.ok).toBe(true)
    if (!lifted.ok) return
    expect(lifted.warning).toContain('could not be activated')
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
    expect(test.placement.snapshot(CLOUD_THREAD)?.move?.phase).toBe(EPlacementMovePhase.Committed)
  })

  it('neither resumes the local source, resumes local children, nor closes the cloud channel', async () => {
    useAtlasHome()
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const { test, lifted, sourceResumes } = await failingActivation({ midTurn: true, agents })

    expect(lifted.ok).toBe(true)
    expect(sourceResumes()).toBe(0)
    expect(agents.resumed).toEqual([])
    expect(test.bridge.channel.closed).toBe(false)
  })

  it('leaves the pre-commit warning absent on a clean lift', async () => {
    useAtlasHome()
    const test = harness()

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    if (!lifted.ok) return
    expect(lifted.warning).toBeUndefined()
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
    expect(test.placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
  })
})
