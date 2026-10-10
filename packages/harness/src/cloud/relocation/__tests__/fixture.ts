import { writeFile } from 'node:fs/promises'

import type { ThreadId } from '@dltech/atlas-core'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'

import type { RestoredWorkspace } from '../../../workspace/transfer/manifest'
import { eventsInArchive } from './fake-transcript'
import { fakeEventLog, fakeLedger, fakeThreadStore } from './fake-backend'
import type { FakeEventLog } from './fake-event-log'
import type { FakeLedger } from './fake-ledger'
import type { FakeThreadStore } from './fake-backend'
import { fakeCloudChannel, type FakeCloudChannel } from './fake-cloud-channel'
import { copyExportTo, copyTranscriptUpload } from './fake-cloud-bridge'
import { WatchedThreadStore } from './watched-thread-store'
import { DUMMY_ARCHIVE } from './workspace-fixture'
import {
  ECloudSandboxState,
  type CloudBridge,
  type CloudSandbox,
  type CloudSandboxStatus,
  type LiftedWorkspace,
} from '../cloud-bridge'

export { CLEAN_WORKSPACE, CLOUD_THREAD } from './cloud-fixture-ids'
export { fakeCloudChannel, type FakeCloudChannel } from './fake-cloud-channel'
export { WatchedThreadStore } from './watched-thread-store'

export type FakeAttachment = {
  channel: FakeCloudChannel
  stores: {
    log: FakeEventLog
    threads: WatchedThreadStore
    ledger: FakeLedger
  }
}

export type FakeBridge = Omit<CloudBridge, 'attach'> & {
  attach(args: { threadId: ThreadId; url: string; token: string }): FakeAttachment
  readonly log: FakeEventLog
  readonly threads: FakeThreadStore
  readonly ledger: FakeLedger
  readonly created: readonly {
    threadId: ThreadId
    workspace: LiftedWorkspace | null
    gpgKey?: string | undefined
    model?: string | undefined
    workspaceArchivePath?: string | undefined
    workspaceDirectory?: string | undefined
  }[]
  readonly downloads: readonly { threadId: ThreadId; path: string; destination: string }[]
  readonly sessionDownloads: readonly {
    threadId: ThreadId
    archive: SessionArchiveDescriptor
    destination: string
  }[]
  readonly sessionReleases: readonly { threadId: ThreadId; path: string }[]
  readonly contextPuts: readonly { threadId: ThreadId; archive: Buffer }[]
  readonly transcriptPuts: readonly { threadId: ThreadId; archivePath: string }[]
  readonly attached: readonly {
    threadId: ThreadId
    url: string
    token: string
  }[]
  readonly destroyed: readonly ThreadId[]
  readonly channel: FakeCloudChannel
  readonly trail: readonly string[]
}

const RUNNING: CloudSandbox = {
  url: 'https://sandbox.example/thread',
  token: 'sandbox-token',
  state: ECloudSandboxState.Running,
  created: true,
  driveName: 'atlas-drive-x',
}

export function fakeBridge(
  args: {
    sandbox?: CloudSandbox
    createFails?: unknown
    putContextFails?: unknown
    putTranscriptFails?: unknown
    downloadSessionFails?: unknown
    releaseSessionFails?: unknown
    confirmLandedFails?: unknown
    confirmLanded?: boolean | undefined
    destroyFails?: unknown
    status?: CloudSandboxStatus | undefined
    threadStore?: FakeThreadStore
    archive?: SessionArchiveDescriptor | null | undefined
    memoryArchive?: string | undefined
    restoreTranscriptRefused?: boolean | undefined
    downloadWorkspaceFails?: unknown
    prepareWorkspaceFails?: unknown
    applyWorkspaceFails?: unknown
    restoredWorkspace?: RestoredWorkspace | undefined
  } = {},
): FakeBridge {
  const log = fakeEventLog()
  const threads = args.threadStore ?? fakeThreadStore({ log })
  const ledger = fakeLedger()
  let channel: FakeCloudChannel | null = null
  const created: {
    threadId: ThreadId
    workspace: LiftedWorkspace | null
    gpgKey?: string | undefined
    model?: string | undefined
    workspaceArchivePath?: string | undefined
    workspaceDirectory?: string | undefined
  }[] = []
  const downloads: { threadId: ThreadId; path: string; destination: string }[] = []
  const sessionDownloads: {
    threadId: ThreadId
    archive: SessionArchiveDescriptor
    destination: string
  }[] = []
  const sessionReleases: { threadId: ThreadId; path: string }[] = []
  const contextPuts: { threadId: ThreadId; archive: Buffer }[] = []
  const transcriptPuts: { threadId: ThreadId; archivePath: string }[] = []
  const attached: { threadId: ThreadId; url: string; token: string }[] = []
  const destroyed: ThreadId[] = []
  const trail: string[] = []

  const watchedThreads = new WatchedThreadStore({ inner: threads, trail })

  return {
    log,
    threads,
    ledger,
    created,
    downloads,
    sessionDownloads,
    sessionReleases,
    contextPuts,
    transcriptPuts,
    attached,
    destroyed,
    get channel() {
      if (channel === null) throw new Error('nothing has attached yet')
      return channel
    },
    trail,
    sandboxes: {
      create: async ({
        threadId,
        workspace,
        gpgKey,
        model,
        captureContext,
        transcriptArchivePath,
        workspaceArchivePath,
        workspaceDirectory,
      }) => {
        if (transcriptArchivePath !== undefined) {
          trail.push('put-transcript')
          transcriptPuts.push({
            threadId,
            archivePath: await copyTranscriptUpload({ source: transcriptArchivePath }),
          })
          if (args.putTranscriptFails !== undefined) throw args.putTranscriptFails
        }
        const sandbox = args.sandbox ?? RUNNING
        if (captureContext !== undefined && sandbox.created) {
          await captureContext(async (archive) => {
            trail.push('put-context')
            contextPuts.push({ threadId, archive: Buffer.from(archive) })
            if (args.putContextFails !== undefined) throw args.putContextFails
          })
        }
        trail.push('sandbox')
        created.push({
          threadId,
          workspace,
          ...(gpgKey === undefined ? {} : { gpgKey }),
          ...(model === undefined ? {} : { model }),
          ...(workspaceArchivePath === undefined ? {} : { workspaceArchivePath }),
          ...(workspaceDirectory === undefined ? {} : { workspaceDirectory }),
        })
        if (args.createFails !== undefined) throw args.createFails
        return sandbox
      },
      putContext: async ({ threadId, archive }) => {
        trail.push('put-context')
        contextPuts.push({ threadId, archive: Buffer.from(archive) })
        if (args.putContextFails !== undefined) throw args.putContextFails
      },
      confirmLanded: async ({ threadId }) => {
        trail.push('confirm-landed')
        if (args.confirmLandedFails !== undefined) throw args.confirmLandedFails
        if (args.confirmLanded === false) return { landed: false }
        return {
          landed: transcriptPuts.some((put) => put.threadId === threadId),
        }
      },
      downloadWorkspace: async ({ threadId, path, destination }) => {
        trail.push('download-workspace')
        downloads.push({ threadId, path, destination })
        if (args.downloadWorkspaceFails !== undefined) throw args.downloadWorkspaceFails
        await writeFile(destination, DUMMY_ARCHIVE)
      },
      downloadSession: async ({ threadId, archive, destination }) => {
        trail.push('download-session')
        sessionDownloads.push({ threadId, archive, destination })
        if (args.downloadSessionFails !== undefined) throw args.downloadSessionFails
        await copyExportTo({ archive, destination })
      },
      releaseSession: async ({ threadId, path }) => {
        trail.push('release-session')
        sessionReleases.push({ threadId, path })
        if (args.releaseSessionFails !== undefined) throw args.releaseSessionFails
      },
      find: async () => args.status,
      readResources: async () => ({}),
      updateResources: async () => {},
      destroy: async ({ threadId }) => {
        trail.push('destroy')
        destroyed.push(threadId)
        if (args.destroyFails !== undefined) throw args.destroyFails
      },
    },
    attach: ({ threadId, url, token }) => {
      trail.push('attach')
      attached.push({ threadId, url, token })
      channel = fakeCloudChannel({
        threadId,
        log,
        archive: args.archive,
        prepareWorkspaceFails: args.prepareWorkspaceFails,
        applyWorkspaceFails: args.applyWorkspaceFails,
        restoredWorkspace: args.restoredWorkspace,
        applyTranscript: async () => {
          const archivePath = transcriptPuts.at(-1)?.archivePath
          if (archivePath !== undefined) log.load(await eventsInArchive(archivePath))
        },
        ...(args.memoryArchive === undefined ? {} : { memoryArchive: args.memoryArchive }),
        ...(args.restoreTranscriptRefused === undefined
          ? {}
          : { restoreTranscriptRefused: args.restoreTranscriptRefused }),
      })
      return { channel, stores: { log, threads: watchedThreads, ledger } }
    },
  }
}
