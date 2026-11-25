import { EClientRequest } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import {
  listContextFilesReplySchema,
  readContextFileReplySchema,
  type ContextFileContentWire,
} from '@dltech/atlas-wire/web'

export type ContextEntry = { name: string; isDirectory: boolean }
export type ContextLevel = { entries: readonly ContextEntry[]; error: boolean }

export type ContextFilesChannel = Pick<
  RemoteDeltaChannel,
  'request' | 'subscribe' | 'threadId' | 'onReload' | 'onReady'
>

export function watchContextFiles(args: {
  channel: ContextFilesChannel
  onLevel: (update: { directory: string; level: ContextLevel }) => void
}): { stop: () => void; load: (directory: string) => void } {
  const { channel, onLevel } = args
  const known = new Set<string>([''])
  let active = true

  const load = (directory: string): void => {
    known.add(directory)
    void channel
      .request({
        op: EClientRequest.ListContextFiles,
        params: directory === '' ? {} : { directory },
      })
      .then((reply) => ({
        entries: listContextFilesReplySchema.parse(reply).entries,
        error: false,
      }))
      .catch((): ContextLevel => ({ entries: [], error: true }))
      .then((level) => {
        if (active) onLevel({ directory, level })
      })
  }
  const refresh = (): void => {
    for (const directory of known) load(directory)
  }

  const offs = [
    channel.subscribe({
      threadId: channel.threadId,
      listener: (signal) => {
        if (signal.type === 'context-changed') refresh()
      },
    }),
    channel.onReload(refresh),
    channel.onReady(refresh),
  ]
  load('')

  return {
    load,
    stop: () => {
      active = false
      for (const off of offs) off()
    },
  }
}

export async function readContextFile(args: {
  channel: Pick<RemoteDeltaChannel, 'request'>
  path: string
}): Promise<ContextFileContentWire> {
  const reply = readContextFileReplySchema.parse(
    await args.channel.request({
      op: EClientRequest.ReadContextFile,
      params: { path: args.path },
    }),
  )
  return reply.file
}
