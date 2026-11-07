import type { SaidUpload } from '../events/body'

export const UPLOADS_BLOB_PREFIX = 'composer-uploads/'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UNSAFE_NAME_CHARACTER = /[\\/\u0000-\u001f\u007f]/

export const uploadBlobPrefixOf = (userId: string): string => `${UPLOADS_BLOB_PREFIX}${userId}/`

export const uploadBlobPathnameOf = (args: {
  userId: string
  uploadId: string
  name: string
}): string => `${uploadBlobPrefixOf(args.userId)}${args.uploadId}/${args.name}`

const isSafeUploadName = (name: string): boolean =>
  name.length > 0 && name !== '.' && name !== '..' && !UNSAFE_NAME_CHARACTER.test(name)

export const isOwnedUpload = (args: {
  upload: Pick<SaidUpload, 'uploadId' | 'pathname' | 'name'>
  userId: string
}): boolean =>
  UUID.test(args.upload.uploadId) &&
  isSafeUploadName(args.upload.name) &&
  args.upload.pathname ===
    uploadBlobPathnameOf({
      userId: args.userId,
      uploadId: args.upload.uploadId,
      name: args.upload.name,
    })
