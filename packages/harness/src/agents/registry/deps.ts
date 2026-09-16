import type {
  ClockPort,
  EventLogPort,
  ExecutionLocationSinkPort,
  IdPort,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store'
import type { AgentType } from '../types'
import type { ChildRunnerSource } from './child-runner'

export type SupervisorDeps = {
  log: EventLogPort
  threads: ThreadStorePort
  ids: IdPort
  clock: ClockPort
  agentTypes: readonly AgentType[]
  runners: ChildRunnerSource
  launchDirectory: string
  sink?: ExecutionLocationSinkPort | undefined
}

export const agentTypeNamed = ({
  agentTypes,
  name,
}: {
  agentTypes: readonly AgentType[]
  name: string
}): AgentType | undefined => agentTypes.find((one) => one.name === name)
