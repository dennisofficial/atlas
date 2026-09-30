import type {
  ClockPort,
  EventLogPort,
  ExecutionLocationSinkPort,
  IdPort,
  TelemetryPort,
  ThreadId,
} from '@dltech/atlas-core'

import type { ThreadModel, ThreadStorePort } from '../../store/thread-store'
import type { AgentType } from '../types'
import type { ChildRunnerSource } from './child-runner'

export type SupervisorDeps = {
  log: EventLogPort
  threads: ThreadStorePort
  ids: IdPort
  clock: ClockPort
  agentTypes: readonly AgentType[]
  runners: ChildRunnerSource
  modelAtSpawn?: ((args: { agentType: AgentType; spawnedBy: ThreadId }) => Promise<ThreadModel | undefined>) | undefined
  launchDirectory: string
  sink?: ExecutionLocationSinkPort | undefined
  telemetry?: TelemetryPort | undefined
}

export const agentTypeNamed = ({
  agentTypes,
  name,
}: {
  agentTypes: readonly AgentType[]
  name: string
}): AgentType | undefined => agentTypes.find((one) => one.name === name)
