import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { EClientRequest, prepareWorkspaceArchiveReplySchema } from '../../channel-wire'
import type { RelocationTransferProgress } from '../../transfer-progress'
import { descendFromCloud } from '../descend'
import { EDescendNode } from '../descend-plan'
import { ELiftNode, liftToCloud } from '../lift'
import { cloudArchiveOf, fakeSurface, useAtlasHome, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'
import { DUMMY_ARCHIVE, fakeRestorer } from './workspace-fixture'

const upload = {
  transferId: 'workspace-upload',
  label: 'uploading workspace',
  transferredBytes: 4,
  totalBytes: 10,
  complete: false,
}

describe('relocation transfer progress', () => {
  it('associates uploads with provisioning without settling the node', async () => {
    useAtlasHome()
    const bridge = fakeBridge()
    const create = bridge.sandboxes.create
    const progress: RelocationTransferProgress[] = []
    const test = harness({ bridge, onTransferProgress: (reading) => progress.push(reading) })
    bridge.sandboxes.create = async (args) => {
      args.onTransferProgress?.(upload)
      expect(test.doneNodes).not.toContain(ELiftNode.Provision)
      args.onTransferProgress?.({ ...upload, transferredBytes: 10, complete: true })
      expect(test.doneNodes).not.toContain(ELiftNode.Provision)
      return create(args)
    }

    expect((await liftToCloud(test.args)).ok).toBe(true)
    expect(progress).toEqual([
      { ...upload, nodeId: ELiftNode.Provision },
      { ...upload, transferredBytes: 10, complete: true, nodeId: ELiftNode.Provision },
    ])
    expect(test.doneNodes).toContain(ELiftNode.Provision)
  })

  for (const knownTotal of [true, false]) {
    it(`forwards ${knownTotal ? 'known' : 'unknown'} export totals and download progress into restoration`, async () => {
      const home = useDescendHome()
      const archive = await cloudArchiveOf([{ drafts: [{ type: 'user-said', text: 'cloud work' }] }])
      const bridge = fakeBridge({ archive })
      const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
      const request = channel.request.bind(channel)
      channel.request = async (args) => {
        const reply = await request(args)
        if (args.op !== EClientRequest.PrepareWorkspaceArchive || !knownTotal) return reply
        return { ...prepareWorkspaceArchiveReplySchema.parse(reply), totalBytes: DUMMY_ARCHIVE.byteLength }
      }
      const progress: RelocationTransferProgress[] = []
      const surface = fakeSurface()
      const download = bridge.sandboxes.downloadWorkspace
      bridge.sandboxes.downloadWorkspace = async (args) => {
        const totalBytes = knownTotal ? DUMMY_ARCHIVE.byteLength : undefined
        expect(args.totalBytes).toBe(totalBytes)
        args.onProgress?.({ transferredBytes: 0, totalBytes, complete: false })
        await download?.(args)
        args.onProgress?.({ transferredBytes: DUMMY_ARCHIVE.byteLength, totalBytes, complete: true })
        expect(surface.doneNodes).not.toContain(EDescendNode.PrepareWorkspace)
      }

      await descendFromCloud({
        threadId: CLOUD_THREAD,
        target: EExecutionLocation.Host,
        midTurn: false,
        bridge,
        channel,
        localApp: home,
        restoreWorkspace: fakeRestorer().restore,
        surface: { ...surface.surface, onTransferProgress: (reading) => progress.push(reading) },
      })

      expect(progress).toHaveLength(2)
      expect(progress[0]).toMatchObject({ nodeId: EDescendNode.PrepareWorkspace, transferId: 'workspace-download', label: 'downloading workspace', transferredBytes: 0, complete: false })
      expect(progress[1]).toMatchObject({ nodeId: EDescendNode.PrepareWorkspace, transferId: 'workspace-download', label: 'downloading workspace', transferredBytes: DUMMY_ARCHIVE.byteLength, complete: true })
      expect(surface.doneNodes).toContain(EDescendNode.PrepareWorkspace)
    })
  }
})
