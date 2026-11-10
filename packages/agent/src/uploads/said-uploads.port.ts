import type { SaidMediaFile, SaidUpload, ThreadId, UploadPlacement } from '@dltech/atlas-core'

export abstract class SaidUploadsPort {
  abstract place(args: {
    threadId: ThreadId
    uploads: readonly SaidUpload[]
    mediaFiles?: readonly SaidMediaFile[] | undefined
    currentFileIds?: ReadonlySet<string> | undefined
    signal?: AbortSignal | undefined
  }): Promise<ReadonlyMap<string, UploadPlacement>>
}
