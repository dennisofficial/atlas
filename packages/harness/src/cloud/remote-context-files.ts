import type { DirectoryEntry } from '@dltech/atlas-core'

import type { ContextFileContent } from '../files/context-browser'
import type { ContextReader } from '../files/session-context'

import { EClientRequest, listContextFilesReplySchema, readContextFileReplySchema } from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel'

type ContextChannel = Pick<RemoteDeltaChannel, 'request'> &
  Partial<Pick<RemoteDeltaChannel, 'subscribe' | 'threadId' | 'onReload'>>

export class RemoteContextFiles implements ContextReader {
  private readonly channel: ContextChannel

  constructor(args: { channel: ContextChannel }) {
    this.channel = args.channel
  }

  async list(directory?: string): Promise<readonly DirectoryEntry[]> {
    const reply = listContextFilesReplySchema.parse(
      await this.channel.request({
        op: EClientRequest.ListContextFiles,
        params: directory === undefined ? {} : { directory },
      }),
    )
    return reply.entries
  }

  async load(path: string): Promise<ContextFileContent> {
    const reply = readContextFileReplySchema.parse(
      await this.channel.request({ op: EClientRequest.ReadContextFile, params: { path } }),
    )
    return reply.file
  }

  subscribe(listener: () => void): () => void {
    const { channel } = this
    const stop = channel.threadId === undefined ? undefined : channel.subscribe?.({
      threadId: channel.threadId,
      listener: (signal) => {
        if (signal.type === 'context-changed' || signal.type === 'events-appended' || signal.type === 'step-ended') listener()
      },
    })
    const stopReload = channel.onReload?.(listener)
    return () => { stop?.(); stopReload?.() }
  }
}
