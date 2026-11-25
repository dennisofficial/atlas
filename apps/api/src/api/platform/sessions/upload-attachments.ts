import { BadRequestException, PayloadTooLargeException } from '@nestjs/common'
import { isOwnedUpload, MAX_UPLOAD_BYTES, type SaidUpload } from '@dltech/atlas-core'
import type { MediaStore } from '@dltech/atlas-media'

export async function attachedUploads(args: {
  store: MediaStore
  userId: string
  uploads: readonly SaidUpload[]
}): Promise<SaidUpload[]> {
  return Promise.all(
    args.uploads.map(async (upload) => {
      if (!isOwnedUpload({ upload, userId: args.userId })) {
        throw new BadRequestException(`file ${upload.name} does not belong to this account`)
      }
      const head = await args.store.head({ pathname: upload.pathname })
      if (head === null) throw new BadRequestException(`file ${upload.name} was not uploaded`)
      if (head.size > MAX_UPLOAD_BYTES) {
        throw new PayloadTooLargeException(`file ${upload.name} is too large`)
      }
      return { ...upload, size: head.size }
    }),
  )
}
