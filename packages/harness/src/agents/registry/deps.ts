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
 * What the thread itself still holds that can wake it again — a shell, a service, pending CI —
 * worded for a reader ("bash \"bun test\""), or undefined when it holds nothing. The supervisor
 * widens this across the thread's sub-agents; a teammate whose subtree holds nothing will never
 * speak again unless someone messages it, so its ending is relayed to the parent rather than
 * recorded quietly.
 */
export type LiveWorkProbe = (threadId: ThreadId) => string | undefined

/**
 * A finished child never drains again, so its pending service and shell notices move to the
 * parent — the earliest thread guaranteed alive to hear them.
 */
export type InheritOrphanedNotices = (args: { from: ThreadId; to: ThreadId }) => void

export type SupervisorDeps = {
  log: EventLogPort
  threads: ThreadStorePort
  ids: IdPort
  clock: ClockPort
  agentTypes: readonly AgentType[]
  runners: ChildRunnerSource
  modelAtSpawn?:
    | ((args: { agentType: AgentType; spawnedBy: ThreadId }) => Promise<ThreadModel | undefined>)
    | undefined
  launchDirectory: string
  sink?: ExecutionLocationSinkPort | undefined
  telemetry?: TelemetryPort | undefined
  intake?: IntakeChanged | undefined
  input?: (() => IntakeSubmit | undefined) | undefined
  liveWork?: LiveWorkProbe | undefined
  inheritOrphanedNotices?: InheritOrphanedNotices | undefined
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
