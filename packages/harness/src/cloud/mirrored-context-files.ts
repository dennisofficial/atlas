import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { ERuntimePhase } from '@dltech/atlas-wire'
import type { DirectoryEntry, ThreadId } from '@dltech/atlas-core'

import type { ContextFileContent } from '../files/context-browser'
import { safeRelativeSegment } from '../files/safe-relative-path'
import type { ContextReader } from '../files/session-context'
import { atlasDirectory } from '../store/paths'
import { contextDirectory } from '../store/sessions/paths'
import { registryFor } from '../store/sessions/registry'
import { EClientRequest, listContextFilesReplySchema, readContextFileReplySchema } from './channel-wire'
import {
  EChannelConnection,
  type ChannelConnection,
  type RemoteDeltaChannel,
  type RuntimeCheckpoint,
} from './remote-delta-channel'

type MirrorChannel = Pick<RemoteDeltaChannel, 'request'> &
  Partial<
    Pick<
      RemoteDeltaChannel,
      'subscribe' | 'threadId' | 'onReload' | 'onCheckpoint'
    >
  > & { connection?: (() => ChannelConnection) | undefined }

type MirrorEntry = { path: string; content: string }

const mirrorableOf = (content: ContextFileContent): string | undefined =>
  content.type === 'text' && !content.truncated ? content.content : undefined

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class MirroredContextFiles implements ContextReader {
  private readonly channel: MirrorChannel
  private readonly local: ContextReader
  private readonly remote: ContextReader
  private readonly mirrorRoot: Promise<string>
  private changeStamp = 1
  private syncedStamp = 0
  private pulling: Promise<boolean> | null = null

  constructor(args: {
    channel: MirrorChannel
    local: ContextReader
    remote: ContextReader
    threadId: ThreadId
    home?: string | undefined
  }) {
    this.channel = args.channel
    this.local = args.local
    this.remote = args.remote
    this.mirrorRoot = registryFor({ home: args.home ?? atlasDirectory() })
      .sessionDirFor({ threadId: args.threadId })
      .then((sessionDir) => contextDirectory({ sessionDir }))
  }

  async list(directory?: string): Promise<readonly DirectoryEntry[]> {
    const synced = await this.ensureSynced()
    if (synced) return this.local.list(directory)
    const mirrored = await this.local.list(directory)
    if (mirrored.length > 0) return mirrored
    return this.remote.list(directory).catch(() => mirrored)
  }

  async load(path: string): Promise<ContextFileContent> {
    const synced = await this.ensureSynced()
    const mirrored = await this.local.load(path)
    if (synced || mirrored.type === 'text') return mirrored
    return this.remote
      .load(path)
      .catch((cause: unknown): ContextFileContent => ({ type: 'refused', reason: messageOf(cause) }))
  }

  subscribe(listener: () => void): () => void {
    const { channel } = this
    const handleSignal = (signal: { type: string }) => {
      if (signal.type === 'context-changed') {
        this.handleContextChanged()
        listener()
        return
      }
      if (signal.type === 'events-appended' || signal.type === 'step-ended') listener()
    }
    const stop = channel.threadId === undefined ? undefined : channel.subscribe?.({
      threadId: channel.threadId,
      listener: handleSignal,
    })
    const stopReload = channel.onReload?.(listener)
    const handleCheckpoint = (checkpoint: RuntimeCheckpoint) => {
      if (checkpoint.phase !== ERuntimePhase.Parked) return
      this.pullInBackground()
    }
    const stopCheckpoint = channel.onCheckpoint?.(handleCheckpoint)
    return () => { stop?.(); stopReload?.(); stopCheckpoint?.() }
  }

  private handleContextChanged(): void {
    this.changeStamp += 1
    this.pullInBackground()
  }

  private isDirty(): boolean {
    return this.changeStamp !== this.syncedStamp
  }

  private remoteReachable(): boolean {
    const connection: ChannelConnection | undefined = this.channel.connection?.()
    if (connection === undefined) return true
    return connection.state === EChannelConnection.Open
  }

  private ensureSynced(): Promise<boolean> {
    if (!this.isDirty() && this.pulling === null) return Promise.resolve(true)
    if (!this.remoteReachable()) return Promise.resolve(false)
    return this.pull()
  }

  private pullInBackground(): void {
    if (!this.remoteReachable()) return
    void this.pull()
  }

  private pull(): Promise<boolean> {
    if (this.pulling !== null) return this.pulling
    const running = this.pullTree()
    this.pulling = running
    void running.then((synced) => {
      this.pulling = null
      if (synced && this.isDirty()) this.pullInBackground()
    })
    return running
  }

  private async pullTree(): Promise<boolean> {
    const stamp = this.changeStamp
    const files = await this.readRemoteTree()
    if (files === null) return false
    try {
      await this.writeMirror({ files })
    } catch {
      return false
    }
    this.syncedStamp = stamp
    return true
  }

  private async readRemoteTree(): Promise<readonly MirrorEntry[] | null> {
    try {
      const entries: MirrorEntry[] = []
      const walk = async (directory: string | undefined): Promise<void> => {
        const listed = listContextFilesReplySchema.parse(
          await this.channel.request({
            op: EClientRequest.ListContextFiles,
            params: directory === undefined ? {} : { directory },
          }),
        ).entries
        for (const entry of listed) {
          const path = directory === undefined ? entry.name : `${directory}/${entry.name}`
          if (entry.isDirectory) {
            await walk(path)
            continue
          }
          const reply = readContextFileReplySchema.parse(
            await this.channel.request({ op: EClientRequest.ReadContextFile, params: { path } }),
          )
          const content = mirrorableOf(reply.file)
          if (content === undefined) continue
          entries.push({ path, content })
        }
      }
      await walk(undefined)
      return entries
    } catch {
      return null
    }
  }

  private async writeMirror(args: { files: readonly MirrorEntry[] }): Promise<void> {
    const root = await this.mirrorRoot
    for (const file of args.files) {
      const safe = safeRelativeSegment(file.path)
      if (safe === null || safe.includes('\0')) continue
      const target = join(root, safe)
      await mkdir(dirname(target), { recursive: true })
      const staged = `${target}.${process.pid}.mirror.tmp`
      await writeFile(staged, file.content, 'utf8')
      await rename(staged, target)
    }
  }
}
