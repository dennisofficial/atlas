import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, EPlacementMovePhase } from '@dltech/atlas-core'

import { PlacementController } from '../../../composition/placement-controller'
import { ERecoveryAction } from '../../../composition/session-recovery'
import { createSessionOwner, ERuntimeKind, type RuntimeBinding } from '../../../composition/session-owner'
import { EClientRequest } from '../../channel-wire'
import { liftToCloud } from '../lift'
import { useAtlasHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'
import { WORKSPACE_MANIFEST } from './workspace-fixture'

type Adapters = { name: string }

const runtime = (args: { kind: ERuntimeKind; name: string }): RuntimeBinding<Adapters> => ({
  kind: args.kind,
  cwd: '/work',
  adapters: { name: args.name },
})

const liftWithRefusedActivation = async () => {
  const bridge = fakeBridge()
  const attach = bridge.attach.bind(bridge)
  const activations: number[] = []
  bridge.attach = (request) => {
    const attachment = attach(request)
    const ask = attachment.channel.request.bind(attachment.channel)
    attachment.channel.request = async (frame) => {
      if (frame.op === EClientRequest.ActivateSession) {
        activations.push(activations.length + 1)
        return { activated: false }
      }
      return ask(frame)
    }
    return attachment
  }
  const test = harness({
    bridge,
    captureWorkspaceArchive: async () => ({
      path: '/tmp/atlas-lift-workspace-x/workspace.tar.gz',
      manifest: WORKSPACE_MANIFEST,
      release: async () => undefined,
    }),
  })
  const lifted = await liftToCloud(test.args)
  return { test, lifted, activations }
}

const coldOwnerOver = async (test: ReturnType<typeof harness>) => {
  const placement = new PlacementController(EExecutionLocation.Host)
  placement.bind({ threads: test.localThreads, workspace: '/work', repo: '/work' })
  const owner = createSessionOwner<Adapters>({
    placement,
    local: runtime({ kind: ERuntimeKind.Local, name: 'local' }),
  })
  await owner.placement.activate({ threadId: CLOUD_THREAD })
  return owner
}

describe('recovering a lift whose cloud activation was refused', () => {
  it('leaves the committed marker standing after the refusal, with the activation asked for exactly once', async () => {
    useAtlasHome()
    const { test, lifted, activations } = await liftWithRefusedActivation()

    expect(lifted.ok).toBe(true)
    expect(activations).toEqual([1])
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
    expect(test.placement.snapshot(CLOUD_THREAD)?.move?.phase).toBe(EPlacementMovePhase.Committed)
  })

  it('has a cold reopen ask to activate the cloud runtime, never to resume the source', async () => {
    useAtlasHome()
    const { test } = await liftWithRefusedActivation()
    const owner = await coldOwnerOver(test)
    const actions: ERecoveryAction[] = []

    await owner.recover({
      threadId: CLOUD_THREAD,
      prepare: async ({ action }) => {
        actions.push(action)
        return runtime({ kind: ERuntimeKind.Cloud, name: 'cloud' })
      },
    })

    expect(actions).toEqual([ERecoveryAction.ActivateCloud])
    expect(owner.placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect(owner.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Cloud)
  })

  it('keeps the marker while the recovering activation keeps failing, then clears it once one succeeds', async () => {
    useAtlasHome()
    const { test } = await liftWithRefusedActivation()
    const owner = await coldOwnerOver(test)
    const actions: ERecoveryAction[] = []
    let attempts = 0
    const prepare = async (given: { action: ERecoveryAction }): Promise<RuntimeBinding<Adapters>> => {
      actions.push(given.action)
      attempts += 1
      if (attempts < 3) throw new Error('the cloud runtime could not be activated yet')
      return runtime({ kind: ERuntimeKind.Cloud, name: 'cloud' })
    }

    await expect(owner.recover({ threadId: CLOUD_THREAD, prepare })).rejects.toThrow('activated yet')
    expect(owner.placement.snapshot(CLOUD_THREAD)?.move?.phase).toBe(EPlacementMovePhase.Committed)

    await expect(owner.recover({ threadId: CLOUD_THREAD, prepare })).rejects.toThrow('activated yet')
    expect(owner.placement.snapshot(CLOUD_THREAD)?.move?.phase).toBe(EPlacementMovePhase.Committed)

    await owner.recover({ threadId: CLOUD_THREAD, prepare })
    expect(owner.placement.snapshot(CLOUD_THREAD)?.move).toBeNull()
    expect(actions).toEqual([
      ERecoveryAction.ActivateCloud,
      ERecoveryAction.ActivateCloud,
      ERecoveryAction.ActivateCloud,
    ])
  })

  it('refuses to clear the marker when the recovery runtime does not fit the cloud placement', async () => {
    useAtlasHome()
    const { test } = await liftWithRefusedActivation()
    const owner = await coldOwnerOver(test)

    await expect(
      owner.recover({
        threadId: CLOUD_THREAD,
        prepare: async () => runtime({ kind: ERuntimeKind.Local, name: 'wrong' }),
      }),
    ).rejects.toThrow('does not fit the move target')

    expect(owner.placement.snapshot(CLOUD_THREAD)?.move?.phase).toBe(EPlacementMovePhase.Committed)
  })

  it('refuses to clear the marker when nothing can prepare the cloud runtime', async () => {
    useAtlasHome()
    const { test } = await liftWithRefusedActivation()
    const owner = await coldOwnerOver(test)

    await expect(owner.recover({ threadId: CLOUD_THREAD })).rejects.toThrow('stays unfinished')

    expect(owner.placement.snapshot(CLOUD_THREAD)?.move?.phase).toBe(EPlacementMovePhase.Committed)
  })
})
