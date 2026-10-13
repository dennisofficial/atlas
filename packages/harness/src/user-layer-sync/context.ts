import type { LogPort } from '@dltech/atlas-core'

import type { UserLayerSyncClient } from './client'
import type { TreeLayout } from './layout'
import type { UserLayerState } from './state'

export type TreeSyncContext = {
  client: UserLayerSyncClient
  state: UserLayerState
  layout: TreeLayout
  log: LogPort
}
