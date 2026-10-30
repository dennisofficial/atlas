import { EUploadState, type SaidUpload, type UploadPlacement } from '@dltech/atlas-core'

import { SaidUploadsPort } from './said-uploads.port'

export class MissingSaidUploads extends SaidUploadsPort {
  async place(args: {
    uploads: readonly SaidUpload[]
  }): Promise<ReadonlyMap<string, UploadPlacement>> {
    return new Map(args.uploads.map((upload) => [upload.uploadId, { state: EUploadState.Missing }]))
  }
}
