import { EClientRequest } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { z } from 'zod'

export type FileTreeChannel = Pick<RemoteDeltaChannel, 'request'>

const browseReplySchema = z.object({
  directory: z.string(),
  entries: z.array(z.object({ name: z.string(), isDirectory: z.boolean() })),
})

export type TreeEntry = { name: string; isDirectory: boolean }

export const ROOT_DIRECTORY = ''

const HIDDEN_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules'])

export const pathWithin = (args: { directory: string; name: string }): string =>
  args.directory === ROOT_DIRECTORY ? args.name : `${args.directory}/${args.name}`

export function orderedEntries(entries: readonly TreeEntry[]): TreeEntry[] {
  return entries
    .filter((entry) => !HIDDEN_NAMES.has(entry.name))
    .sort((left, right) =>
      left.isDirectory === right.isDirectory
        ? left.name.localeCompare(right.name)
        : left.isDirectory
          ? -1
          : 1,
    )
}

export async function browseDirectory(args: {
  channel: FileTreeChannel
  directory: string
}): Promise<TreeEntry[]> {
  const reply = browseReplySchema.parse(
    await args.channel.request({
      op: EClientRequest.BrowseDirectory,
      params: { directory: args.directory },
    }),
  )
  return orderedEntries(reply.entries)
}
