import type { AgentFileSystemPort, ThreadId } from '@dltech/atlas-core'

import { LocalFileSystemPort } from '../execution/local-filesystem'

export async function digestOf(args: {
  path: string
  files?: AgentFileSystemPort | undefined
  threadId?: ThreadId | undefined
}): Promise<string | undefined> {
  const files = args.files ?? new LocalFileSystemPort()
  try {
    return Bun.hash.wyhash(await files.readBytes({ path: args.path, threadId: args.threadId })).toString(16)
  } catch {
    return undefined
  }
}
