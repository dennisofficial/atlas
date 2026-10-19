import { join } from 'node:path'

import type { LogPort, NoticePort } from '@dltech/atlas-core'

import type { UserLayerSyncClient } from './client'
import { UserLayerSyncEngine } from './engine'
import { userLayerTrees, type UserLayerRootsArgs } from './roots'

const SYNC_DIRECTORY_NAME = 'sync'
const STATE_FILE_NAME = 'user-layer-sync.json'

export const userLayerStateFile = (atlasHome: string): string =>
  join(atlasHome, SYNC_DIRECTORY_NAME, STATE_FILE_NAME)

export function createUserLayerSync(
  args: UserLayerRootsArgs & {
    client: UserLayerSyncClient
    log: LogPort
    notice?: NoticePort | undefined
    debounceMs?: number | undefined
  },
): UserLayerSyncEngine {
  return new UserLayerSyncEngine({
    client: args.client,
    trees: userLayerTrees(args),
    stateFile: userLayerStateFile(args.atlasHome),
    log: args.log,
    notice: args.notice,
    debounceMs: args.debounceMs,
  })
}
