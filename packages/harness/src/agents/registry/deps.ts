import type {
  ClockPort,
  EventLogPort,
  ExecutionLocationSinkPort,
  IdPort,
  TelemetryPort,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store'
import type { MessageIntake } from '../../intake/message-intake'
import type { AgentType } from '../types'
import type { ChildRunnerSource } from './child-runner'

export type IntakeChanged = Pick<MessageIntake, 'changed' | 'prepare'>

export type IntakeSubmit = Pick<MessageIntake, 'changed' | 'submit' | 'hold' | 'commit'>

export type SupervisorDeps = {
  log: EventLogPort
  threads: ThreadStorePort
  ids: IdPort
  clock: ClockPort
  agentTypes: readonly AgentType[]
  runners: ChildRunnerSource
  launchDirectory: string
  sink?: ExecutionLocationSinkPort | undefined
  telemetry?: TelemetryPort | undefined
  intake?: IntakeChanged | undefined
  input?: (() => IntakeSubmit | undefined) | undefined
}

export const agentTypeNamed = ({
  agentTypes,
  name,
}: {
  agentTypes: readonly AgentType[]
  name: string
}): AgentType | undefined => agentTypes.find((one) => one.name === name)
