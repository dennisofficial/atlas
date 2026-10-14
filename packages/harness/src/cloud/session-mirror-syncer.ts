import type { ThreadId } from '@dltech/atlas-core'
import type { SessionMirrorFile } from '@dltech/atlas-wire'

import type { ChannelListener } from '../channel/delta-channel'
import {
  EClientRequest,
  readSessionFilesReplySchema,
  sessionManifestReplySchema,
} from './channel-wire'
import {
  EChannelConnection,
  type ChannelConnection,
  type RemoteDeltaChannel,
} from './remote-delta-channel'
import { readMirrorStamp, type MirrorStamp } from './session-mirror-stamp'
import type { SessionMirrorFileWrite, SessionMirrorWriter } from './session-mirror-writer'

type MirrorChannel = Pick<
  RemoteDeltaChannel,
  'subscribe' | 'onReload' | 'onReady' | 'request' | 'connection' | 'onConnection'
>

export type SessionMirrorSync = {
  kick(): void
  converge(): Promise<void>
  subscribe(listener: () => void): () => void
  current(): { revision: number } | undefined
}

const FILES_PER_PULL = 64

const keyOf = (file: Pick<SessionMirrorFile, 'path'>): string => file.path

const diffOf = (args: {
  local: MirrorStamp | undefined
  remote: readonly SessionMirrorFile[]
}): { pulls: string[]; deletions: string[] } => {
  const remoteByPath = new Map(args.remote.map((file) => [file.path, file]))
  const localFiles = args.local?.files ?? {}
  const pulls: string[] = []
  for (const file of args.remote) {
    const held = localFiles[file.path]
    if (held === undefined || held.bytes !== file.bytes || held.sha256 !== file.sha256) pulls.push(file.path)
  }
  const deletions = Object.keys(localFiles).filter((path) => !remoteByPath.has(path))
  return { pulls, deletions }
}

export function createSessionMirrorSync(args: {
  channel: MirrorChannel
  writer: SessionMirrorWriter
  threadId: ThreadId
  onSyncFailed?: ((failure: unknown) => void) | undefined
  onSyncRecovered?: (() => void) | undefined
}): SessionMirrorSync {
  const listeners = new Set<() => void>()
  let connection: ChannelConnection = args.channel.connection()
  let running = false
  let dirty = true
  let failed = false
  let currentRevision: number | undefined
  const settled = new Set<{ resolve: () => void; reject: (failure: unknown) => void }>()

  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const pullFiles = async (paths: readonly string[]): Promise<SessionMirrorFileWrite[]> => {
    const writes: SessionMirrorFileWrite[] = []
    for (let at = 0; at < paths.length; at += FILES_PER_PULL) {
      const batch = paths.slice(at, at + FILES_PER_PULL)
      const reply = readSessionFilesReplySchema.parse(
        await args.channel.request({ op: EClientRequest.ReadSessionFiles, params: { paths: batch } }),
      )
      for (const file of reply.files) {
        writes.push({
          path: file.path,
          content:
            file.encoding === 'base64'
              ? Buffer.from(file.content, 'base64')
              : Buffer.from(file.content, 'utf8'),
        })
      }
    }
    return writes
  }

  const sync = async (): Promise<void> => {
    const reply = sessionManifestReplySchema.parse(
      await args.channel.request({ op: EClientRequest.ReadSessionManifest, params: {} }),
    )
    const sessionDir = await args.writer.sessionDirFor({ threadId: args.threadId })
    const local = await readMirrorStamp({ sessionDir })
    const diff = diffOf({ local, remote: reply.files })
    const stale =
      local === undefined ? [] : await args.writer.findStaleDeletions({ threadId: args.threadId, stamp: local })
    const pulls = [...new Set([...diff.pulls, ...stale])]
    const deletions = diff.deletions.filter((path) => !stale.includes(path))
    const writes = await pullFiles(pulls)
    const stamp: MirrorStamp = {
      v: 1,
      revision: reply.revision,
      syncedAt: new Date().toISOString(),
      files: Object.fromEntries(
        reply.files.map((file) => [keyOf(file), { bytes: file.bytes, sha256: file.sha256 }]),
      ),
    }
    if (writes.length === 0 && deletions.length === 0 && local?.revision === reply.revision) {
      currentRevision = reply.revision
      return
    }
    await args.writer.apply({ threadId: args.threadId, writes, deletions, stamp })
    currentRevision = reply.revision
    emit()
  }

  const drain = async (): Promise<void> => {
    let failure: unknown = null
    try {
      for (;;) {
        if (connection.state !== EChannelConnection.Open) return
        if (!dirty) return
        dirty = false
        try {
          await sync()
          if (failed) {
            failed = false
            args.onSyncRecovered?.()
          }
        } catch (error) {
          failure = error
          dirty = true
          failed = true
          args.onSyncFailed?.(error)
          return
        }
      }
    } finally {
      running = false
      for (const waiter of [...settled]) {
        settled.delete(waiter)
        if (failure !== null) waiter.reject(failure)
        else waiter.resolve()
      }
    }
  }

  const enqueue = (): void => {
    dirty = true
    if (running || connection.state !== EChannelConnection.Open) return
    running = true
    void drain()
  }

  const handleSignal: ChannelListener = (signal) => {
    if (signal.type === 'session-files-changed') {
      if (currentRevision === undefined || signal.revision !== currentRevision) enqueue()
      return
    }
    if (signal.type === 'events-appended' || signal.type === 'context-changed') enqueue()
  }

  args.channel.subscribe({ threadId: args.threadId, listener: handleSignal })
  args.channel.onReload(() => enqueue())
  args.channel.onReady(() => enqueue())
  args.channel.onConnection((next) => {
    const wasOpen = connection.state === EChannelConnection.Open
    connection = next
    if (next.state === EChannelConnection.Open && !wasOpen) enqueue()
  })

  return {
    kick: enqueue,
    converge() {
      enqueue()
      if (connection.state !== EChannelConnection.Open) return Promise.resolve()
      if (!running && !dirty) return Promise.resolve()
      return new Promise((resolve, reject) => {
        settled.add({ resolve, reject })
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    current: () => (currentRevision === undefined ? undefined : { revision: currentRevision }),
  }
}
