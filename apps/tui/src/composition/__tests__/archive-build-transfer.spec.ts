import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import {
  EArchivePhase,
  EDescendNode,
  type ArchiveProgressSignal,
  type ChannelListener,
  type ChannelSignal,
  type RelocationTransferProgress,
} from '@dltech/atlas-harness'

import { archiveBuildTransfer, followArchiveBuild } from '../archive-build-transfer'

const THREAD = toThreadId('thread')

const signal = (over: Partial<ArchiveProgressSignal> = {}): ArchiveProgressSignal =>
  ({ type: 'archive-progress', archive: 'workspace', phase: EArchivePhase.Staging, files: 12, bytes: 4096, ...over }) as ArchiveProgressSignal

const fakeChannel = () => {
  const listeners = new Set<ChannelListener>()
  return {
    listeners,
    emit: (next: ChannelSignal) => {
      for (const listener of [...listeners]) listener(next)
    },
    subscribe: ({ listener }: { threadId: unknown; listener: ChannelListener }) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

describe('archiveBuildTransfer', () => {
  it('maps a workspace build onto the prepareWorkspace node', () => {
    expect(archiveBuildTransfer(signal())).toEqual({
      nodeId: EDescendNode.PrepareWorkspace,
      transferId: 'archive-build-workspace',
      label: 'packing the workspace',
      transferredBytes: 4096,
      totalBytes: undefined,
      complete: false,
    })
  })

  it('maps a transcript build onto the archiveRemote node and carries the total', () => {
    expect(archiveBuildTransfer(signal({ archive: 'transcript', phase: EArchivePhase.Compressing, totalBytes: 9000 }))).toEqual({
      nodeId: EDescendNode.ArchiveRemote,
      transferId: 'archive-build-transcript',
      label: 'compressing the transcript',
      transferredBytes: 4096,
      totalBytes: 9000,
      complete: false,
    })
  })

  it('words each phase honestly', () => {
    const labels = [EArchivePhase.Walking, EArchivePhase.Staging, EArchivePhase.Compressing].map(
      (phase) => archiveBuildTransfer(signal({ archive: 'transcript', phase })).label,
    )

    expect(labels).toEqual(['scanning the transcript', 'packing the transcript', 'compressing the transcript'])
  })
})

describe('followArchiveBuild', () => {
  it('forwards only archive-progress signals, mapped', () => {
    const channel = fakeChannel()
    const seen: RelocationTransferProgress[] = []
    followArchiveBuild({ channel, threadId: THREAD, onProgress: (progress) => seen.push(progress) })

    channel.emit({ type: 'events-appended' })
    channel.emit(signal({ archive: 'transcript', phase: EArchivePhase.Walking, bytes: 0 }))
    channel.emit({ type: 'turn-working', working: true })
    channel.emit(signal())

    expect(seen.map((progress) => [progress.nodeId, progress.transferId])).toEqual([
      [EDescendNode.ArchiveRemote, 'archive-build-transcript'],
      [EDescendNode.PrepareWorkspace, 'archive-build-workspace'],
    ])
  })

  it('stops delivering once the returned unsubscribe runs', () => {
    const channel = fakeChannel()
    const seen: RelocationTransferProgress[] = []
    const stop = followArchiveBuild({ channel, threadId: THREAD, onProgress: (progress) => seen.push(progress) })

    stop()
    channel.emit(signal())

    expect(channel.listeners.size).toBe(0)
    expect(seen).toEqual([])
  })
})
