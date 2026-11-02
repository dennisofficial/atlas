import {
  LoopTurnRunner as AgentLoopTurnRunner,
  type PendingDrain,
  type TurnDeps as AgentTurnDeps,
} from '@dltech/atlas-agent'

import type { EventLogPort } from '@dltech/atlas-core'

import { eventLogAgentRecord } from './event-log-agent-record'
import { modelFailureDiagnosticsOf } from '../model/failure-diagnostics'
import { normalizeProviderFailure } from '../model/failure'

export type { PendingDrain }

export type TurnDeps = Omit<
  AgentTurnDeps,
  'normalizeFailure' | 'failureDiagnostics' | 'launchDirectory' | 'record' | 'modelContext'
> & { log: EventLogPort; launchDirectory?: string | undefined }

export class LoopTurnRunner extends AgentLoopTurnRunner {
  constructor(deps: TurnDeps) {
    super({
      ...deps,
      ...eventLogAgentRecord(deps.log),
      launchDirectory: deps.launchDirectory ?? process.cwd(),
      normalizeFailure: normalizeProviderFailure,
      failureDiagnostics: modelFailureDiagnosticsOf,
    })
  }
}
