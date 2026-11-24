import { listBlobsOlderThan, VercelMediaStore } from '@dltech/atlas-media'
import { COMPOSER_UPLOADS_PREFIX } from '@dltech/atlas-wire'

export const COMPOSER_UPLOAD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const DELETE_BATCH_SIZE = 100

export type ComposerUploadSweepStore = {
  listOlderThan(args: { prefix: string; before: Date }): Promise<string[]>
  delete(args: { pathnames: string[] }): Promise<void>
}

export const composerUploadSweepStoreOf = (
  env: Record<string, string | undefined>,
): ComposerUploadSweepStore => {
  const token = env['BLOB_READ_WRITE_TOKEN']
  if (!token) throw new Error('upload storage is not configured')
  const media = new VercelMediaStore({ token })

  return {
    listOlderThan: (args) =>
      listBlobsOlderThan({ token, prefix: args.prefix, before: args.before }),
    delete: (args) => media.delete(args),
  }
}

export async function sweepComposerUploads(args: {
  store: ComposerUploadSweepStore
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
