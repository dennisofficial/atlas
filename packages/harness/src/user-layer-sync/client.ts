import type { CloudUserFilesClient } from '../cloud/user-files-client'

export type UserLayerSyncClient = Pick<
  CloudUserFilesClient,
  'listUserFiles' | 'getUserFiles' | 'putUserFile' | 'deleteUserFile'
>
