import type { DirectoryEntry, ThreadId } from '@dltech/atlas-core'

import { EFileLoad, type LoadedFile } from '../files/file-browser'
import type { MentionReader } from '../files/mention-reader'

import {
  EClientRequest,
  listMentionFilesReplySchema,
  mentionFileExistsReplySchema,
  readMentionFileReplySchema,
} from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel'

export class RemoteMentionFiles implements MentionReader {
  private readonly channel: Pick<RemoteDeltaChannel, 'request'>
  private readonly threadId: ThreadId

  constructor(args: { channel: Pick<RemoteDeltaChannel, 'request'>; threadId: ThreadId }) {
    this.channel = args.channel
    this.threadId = args.threadId
  }

  async list(directory: string): Promise<readonly DirectoryEntry[]> {
    const reply = await this.channel.request({
      op: EClientRequest.ListMentionFiles,
      params: { threadId: this.threadId, directory },
    })
    return listMentionFilesReplySchema.parse(reply).entries
  }

  async exists(path: string): Promise<boolean> {
    const reply = await this.channel.request({
      op: EClientRequest.MentionFileExists,
      params: { threadId: this.threadId, path },
    })
    return mentionFileExistsReplySchema.parse(reply).exists
  }

  async load(path: string): Promise<LoadedFile> {
    const reply = await this.channel.request({
      op: EClientRequest.ReadMentionFile,
      params: { threadId: this.threadId, path },
    })
    const { file } = readMentionFileReplySchema.parse(reply)
    if (file.type === 'text') return { ...file, type: EFileLoad.Text }
    if (file.type === 'listing') return { ...file, type: EFileLoad.Listing }
    return { ...file, type: EFileLoad.Refused }
  }

  forget(): void {}
}
