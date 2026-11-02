import {
  LoopTurnRunner as AgentLoopTurnRunner,
  type AgentOutput,
  type PendingDrain,
  type ToolOutputNotice,
  type TurnDeps as AgentTurnDeps,
} from '@dltech/atlas-agent'

import type { EventLogPort } from '@dltech/atlas-core'

import { eventLogAgentRecord } from './event-log-agent-record'
import { modelFailureDiagnosticsOf } from '../model/failure-diagnostics'
import { normalizeProviderFailure } from '../model/failure'

export type { PendingDrain }

export type TurnDeps = Omit<
  AgentTurnDeps,
  | 'normalizeFailure'
  | 'failureDiagnostics'
  | 'launchDirectory'
  | 'record'
  | 'modelContext'
  | 'output'
> & {
  log: EventLogPort
  launchDirectory?: string | undefined
  onToolOutput?: ((output: ToolOutputNotice) => void) | undefined
  onContext?: ((args: { tokens: number; window: number }) => void) | undefined
}

const outputOf = (deps: TurnDeps): AgentOutput | undefined => {
  const { onToolOutput, onContext } = deps
  if (onToolOutput === undefined && onContext === undefined) return undefined
  return {
    emit: (event) => {
      if (event.type === 'tool-output') onToolOutput?.(event.output)
      if (event.type === 'context-size') onContext?.(event)
    },
  }
}

export class LoopTurnRunner extends AgentLoopTurnRunner {
  constructor(deps: TurnDeps) {
    super({
      ...deps,
      output: outputOf(deps),
      ...eventLogAgentRecord(deps.log),
      launchDirectory: deps.launchDirectory ?? process.cwd(),
      normalizeFailure: normalizeProviderFailure,
      failureDiagnostics: modelFailureDiagnosticsOf,
    })
  }
}
