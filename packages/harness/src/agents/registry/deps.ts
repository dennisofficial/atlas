import type {
  ClockPort,
  EventLogPort,
  ExecutionLocationSinkPort,
  IdPort,
  TelemetryPort,
  ThreadId,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store'
import type { MessageIntake } from '../../intake/message-intake'
import type { ThreadModel } from '../../store/thread-store'
import type { AgentType } from '../types'
import type { ChildRunnerSource } from './child-runner'

export type IntakeChanged = Pick<MessageIntake, 'changed' | 'prepare'>

export type IntakeSubmit = Pick<MessageIntake, 'changed' | 'submit' | 'hold' | 'commit'>

/**
 * Whether a thread still has work that can wake it again — live shells, services or child agents.
 * A teammate whose turn ends with none of these will never speak again unless someone messages it,
 * so its ending is relayed to the parent rather than recorded quietly.
 */
export type HasLiveWork = (threadId: ThreadId) => boolean

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
  intake?: IntakeChanged | undefined
  input?: (() => IntakeSubmit | undefined) | undefined
  hasLiveWork?: HasLiveWork | undefined
  /** Fired when a child's ending is recorded, so live wiring can hand back what ending orphans (its worktree claim). */
  onChildEnded?: ((threadId: ThreadId) => void) | undefined
}

export const agentTypeNamed = ({
  agentTypes,
  name,
}: {
  agentTypes: readonly AgentType[]
  name: string
}): AgentType | undefined => agentTypes.find((one) => one.name === name)
