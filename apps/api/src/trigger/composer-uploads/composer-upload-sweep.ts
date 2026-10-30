import { COMPOSER_UPLOADS_PREFIX } from '@dltech/atlas-wire'
import type { ComposerUploadBlobStore } from '../../api/cloud/composer-uploads/composer-upload-blob-store'

export const COMPOSER_UPLOAD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DELETE_BATCH_SIZE = 100

export async function sweepComposerUploads(args: {
  store: ComposerUploadBlobStore
  now: () => Date
}): Promise<{ deleted: number }> {
  const before = new Date(args.now().getTime() - COMPOSER_UPLOAD_MAX_AGE_MS)
  const pathnames = await args.store.listOlderThan({
    prefix: COMPOSER_UPLOADS_PREFIX,
    before,
  })
  for (let start = 0; start < pathnames.length; start += DELETE_BATCH_SIZE) {
    await args.store.delete({
      pathnames: pathnames.slice(start, start + DELETE_BATCH_SIZE),
    })
  }
  return { deleted: pathnames.length }
}
