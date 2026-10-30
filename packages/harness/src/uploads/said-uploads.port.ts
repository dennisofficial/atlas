import type { SaidUpload, ThreadId, UploadPlacement } from '@dltech/atlas-core'

export abstract class SaidUploadsPort {
  abstract place(args: {
    threadId: ThreadId
    uploads: readonly SaidUpload[]
    currentUploadIds?: ReadonlySet<string> | undefined
    signal?: AbortSignal | undefined
  }): Promise<ReadonlyMap<string, UploadPlacement>>
}
