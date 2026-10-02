import { runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

export function storedCheckpointOf(args: {
  threadId: string
  checkpoint: unknown
  revision: number | null
}): RuntimeCheckpoint | null {
  if (args.checkpoint === null || args.checkpoint === undefined || args.revision === null) {
    return null
  }
  const parsed = runtimeCheckpointSchema.safeParse(args.checkpoint)
  if (!parsed.success) return null
  if (parsed.data.revision !== args.revision) return null
  if (parsed.data.threadId !== args.threadId) return null
  return parsed.data
}
