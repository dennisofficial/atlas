import type { AgentFileSystemPort, ThreadId } from '@dltech/atlas-core'

export async function digestOf(args: {
  path: string
  files: AgentFileSystemPort
  threadId?: ThreadId | undefined
}): Promise<string | undefined> {
  const { files } = args
  try {
    return Bun.hash
      .wyhash(await files.readBytes({ path: args.path, threadId: args.threadId }))
      .toString(16)
  } catch {
    return undefined
  }
}
