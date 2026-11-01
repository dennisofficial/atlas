import type {
  ClockPort,
  EKilledBy,
  EventLogPort,
  ExecutionLocationSinkPort,
  IdPort,
  TelemetryPort,
  ThreadId,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store'
import type { MessageIntake } from '../../intake/message-intake'
import type { ModelWaitState } from '../../model-recovery/wait-state'
import type { ThreadModel } from '../../store/thread-store'
import type { AgentType } from '../types'
import type { ChildRunnerSource } from './child-runner'

export type IntakeChanged = Pick<MessageIntake, 'changed' | 'prepare'>

export type IntakeSubmit = Pick<MessageIntake, 'changed' | 'submit' | 'hold' | 'commit'>

/**
 * The running background shell the thread owns, worded for a reader (`bash "bun test"`), or
 * undefined when it owns none. A sub-agent that ends its turn while this is defined is held, not
 * ended: the shell's ending wakes it again.
 */
export type RunningShellProbe = (threadId: ThreadId) => string | undefined

export type LeftServicesProbe = (threadId: ThreadId) => readonly string[]

/**
 * Kills the running background shells the thread owns and resolves once their endings are queued,
 * so a settled child hands them to its parent instead of leaving them on a thread nobody drains.
 */
export type EndShells = (args: { threadId: ThreadId; by: EKilledBy }) => Promise<void>

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
  waitState?: Pick<ModelWaitState, 'episodeOf'> | undefined
  input?: (() => IntakeSubmit | undefined) | undefined
  runningShell?: RunningShellProbe | undefined
  endShells?: EndShells | undefined
  leftServices?: LeftServicesProbe | undefined
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
