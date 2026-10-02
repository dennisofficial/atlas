import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { CloudError } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { ELiftFault, ELiftStep, liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { FOOTER_SELECTION, harness } from './lift-fixture'
import { WORKSPACE_MANIFEST } from './workspace-fixture'

describe('the workspace a lift carries', () => {
  it('reads a 413 as the patch being too large, keeping the advice the API gave', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      createFails: new CloudError({
        status: 413,
        message:
          'The Atlas Cloud API answered POST /v1/sandboxes with 413: the uncommitted patch is 7.2 MiB, over the 5 MiB ceiling — commit or discard some work before lifting.',
      }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.fault).toBe(ELiftFault.PatchTooLarge)
    expect(lifted.detail).toContain('commit or discard some work')
  })

  it('sends no workspace when there is no repository behind the session', async () => {
    useAtlasHome()
    const test = harness({ capture: async () => null })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([
      { threadId: CLOUD_THREAD, workspace: null, model: FOOTER_SELECTION.ref },
    ])
  })

  it('says so in the transition notice when no repository came with it', async () => {
    useAtlasHome()
    const test = harness({ capture: async () => null })

    await liftToCloud(test.args)

    const notice = test.localLog
      .peek({ threadId: CLOUD_THREAD })
      .find((event) => event.type === 'context-loaded')
    if (notice === undefined || notice.type !== 'context-loaded') {
      throw new Error('expected a transition notice in the local log')
    }

    expect(notice.content).toContain('no Git repository')
  })

  it('reads a failed physical capture as a transfer fault at the capturing step, before any sandbox exists', async () => {
    useAtlasHome()
    const test = harness({
      captureWorkspaceArchive: async () => {
        throw new Error('the workspace holds a socket file it cannot archive')
      },
    })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.fault).toBe(ELiftFault.Transfer)
    expect(lifted.step).toBe(ELiftStep.Capturing)
    expect(lifted.detail).toContain('socket file')
    expect(test.bridge.created).toEqual([])
    expect(test.placement.of(CLOUD_THREAD)).toBe(EExecutionLocation.Host)
  })

  it('hands the captured archive path to the sandbox request and releases it afterwards', async () => {
    useAtlasHome()
    let released = 0
    const test = harness({
      captureWorkspaceArchive: async () => ({
        path: '/tmp/atlas-lift-workspace-x/workspace.tar.gz',
        manifest: WORKSPACE_MANIFEST,
        release: async () => {
          released += 1
        },
      }),
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created[0]?.workspaceArchivePath).toBe('/tmp/atlas-lift-workspace-x/workspace.tar.gz')
    expect(released).toBe(1)
  })
})
