import type { EventLogPort, IdPort } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { ThreadStorePort } from '../store/thread-store'

import type { RotationSummariser } from './carry-over-summary'

export type RotationDeps = {
  log: EventLogPort
  threads: ThreadStorePort
  agents: AgentRegistryPort
  ids: IdPort
  summarise: RotationSummariser
}
