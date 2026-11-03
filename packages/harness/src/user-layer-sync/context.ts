import type { NoticePort } from '@dltech/atlas-core'

import type { UserLayerSyncClient } from './client'
import type { TreeLayout } from './layout'
import type { UserLayerState } from './state'
import type { LogPort } from '@dltech/atlas-observability'

export type TreeSyncContext = {
  client: UserLayerSyncClient
  state: UserLayerState
  layout: TreeLayout
  log: LogPort
  notice?: NoticePort | undefined
}
