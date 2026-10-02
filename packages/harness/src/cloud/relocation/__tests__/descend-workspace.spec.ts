import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { EClientRequest } from '../../channel-wire'
import { EWorkspaceRestoreMode } from '../../../workspace/transfer/restore'

import { cloudArchiveOf, descend, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { DUMMY_ARCHIVE, EXPORT_PATH, fakeRestorer } from './workspace-fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const homeWithArchive = async (
  texts: readonly string[],
  over: Parameters<typeof fakeBridge>[0] = {},
): Promise<{ home: ReturnType<typeof useDescendHome>; bridge: ReturnType<typeof fakeBridge> }> => {
  const home = useDescendHome()
  const archive = await cloudArchiveOf([{ drafts: texts.map(said) }])
  return { home, bridge: fakeBridge({ archive, ...over }) }
}

describe('bringing the cloud workspace home', () => {
  it('prepares the export, downloads it, and hands the bytes to the restorer for the host', async () => {
    const { home, bridge } = await homeWithArchive(['work happened in the cloud'])
    const restorer = fakeRestorer()

    await descend({ bridge, home, restoreWorkspace: restorer.restore })

    expect(bridge.downloads).toHaveLength(1)
    expect(bridge.downloads[0]).toMatchObject({ threadId: CLOUD_THREAD, path: EXPORT_PATH })
    expect(restorer.calls).toHaveLength(1)
    const call = restorer.calls[0]
    expect(call?.archive).toEqual(DUMMY_ARCHIVE)
    expect(call?.destination).toBe('/work')
    expect(call?.mode).toBe(EWorkspaceRestoreMode.Host)
    expect(call?.archivePath).toBe(bridge.downloads[0]?.destination ?? '')
  })

  it('pauses the sandbox and waits for the acknowledgement before asking for the export', async () => {
    const { home, bridge } = await homeWithArchive(['paused first'])
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const order: string[] = []
    const pause = channel.pause.bind(channel)
    channel.pause = () => {
      order.push('pause')
      pause()
    }
    const served = channel.request.bind(channel)
    channel.request = async (given) => {
      if (given.op === EClientRequest.PrepareWorkspaceArchive) order.push('prepare')
      return served(given)
    }

    await descend({ bridge, home, channel })

    expect(order).toEqual(['pause', 'prepare'])
  })

  it('removes the downloaded archive after restoring it', async () => {
    const { home, bridge } = await homeWithArchive(['cleanup'])
    const restorer = fakeRestorer()

    await descend({ bridge, home, restoreWorkspace: restorer.restore })

    const archivePath = restorer.calls[0]?.archivePath ?? ''
    expect(await Bun.file(archivePath).exists()).toBe(false)
  })

  it('fails the move before the flip and keeps the source when the download fails', async () => {
    const { home, bridge } = await homeWithArchive(['stuck in the cloud'], {
      downloadWorkspaceFails: new Error('the sandbox export vanished'),
    })
    const restorer = fakeRestorer()

    await expect(descend({ bridge, home, restoreWorkspace: restorer.restore })).rejects.toThrow(
      'the sandbox export vanished',
    )

    expect(restorer.calls).toEqual([])
    expect(bridge.destroyed).toEqual([])
    expect(bridge.channel.paused).toBe(false)
  })

  it('fails the move and keeps the source when the sandbox cannot prepare the export', async () => {
    const { home, bridge } = await homeWithArchive(['no export'], {
      prepareWorkspaceFails: new Error('the nested worktree holds dirty files'),
    })
    const restorer = fakeRestorer()

    await expect(descend({ bridge, home, restoreWorkspace: restorer.restore })).rejects.toThrow(
      'dirty files',
    )

    expect(bridge.downloads).toEqual([])
    expect(restorer.calls).toEqual([])
    expect(bridge.destroyed).toEqual([])
  })

  it('keeps the source and flips nothing when the restore itself fails', async () => {
    const { home, bridge } = await homeWithArchive(['restore breaks'])
    const restorer = fakeRestorer({ fails: new Error('the destination branch moved') })

    await expect(descend({ bridge, home, restoreWorkspace: restorer.restore })).rejects.toThrow(
      'the destination branch moved',
    )

    const row = await home.threads.find({ threadId: CLOUD_THREAD })
    expect(row?.executionLocation ?? EExecutionLocation.Cloud).toBe(EExecutionLocation.Cloud)
    expect(bridge.destroyed).toEqual([])
    expect(bridge.channel.paused).toBe(false)
  })

  it('restores nothing and downloads nothing when the cloud transcript is invalid', async () => {
    const { home, bridge } = await homeWithArchive(['unused'], { archive: '' })
    const restorer = fakeRestorer()

    await expect(descend({ bridge, home, restoreWorkspace: restorer.restore })).rejects.toThrow(
      'the cloud holds no transcript',
    )

    expect(restorer.calls).toEqual([])
    expect(bridge.downloads).toEqual([])
    expect(bridge.channel.requests.map((entry) => entry.op)).not.toContain(
      EClientRequest.PrepareWorkspaceArchive,
    )
    expect(bridge.destroyed).toEqual([])
  })

  it('puts the original local transcript back, with no imported or spawned events, when the restore fails', async () => {
    const { home, bridge } = await homeWithArchive(['cloud words'])
    await home.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: home.ids.nextRunId(),
      drafts: [said('original local words')],
      workspace: '/work',
      executionLocation: EExecutionLocation.Cloud,
    })
    const restorer = fakeRestorer({ fails: new Error('the destination branch moved') })

    await expect(descend({ bridge, home, restoreWorkspace: restorer.restore })).rejects.toThrow(
      'the destination branch moved',
    )

    const events = await home.log.read({ threadId: CLOUD_THREAD })
    expect(events.map((event) => event.type)).toEqual(['user-said'])
    expect(events[0]?.type === 'user-said' && events[0].text).toBe('original local words')
    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation).toBe(
      EExecutionLocation.Cloud,
    )
  })
})
