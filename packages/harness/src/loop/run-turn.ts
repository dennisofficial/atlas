import {
  LoopTurnRunner as AgentLoopTurnRunner,
  type PendingDrain,
  type TurnDeps as AgentTurnDeps,
} from '@dltech/atlas-agent'

import { modelFailureDiagnosticsOf } from '../model/failure-diagnostics'
import { normalizeProviderFailure } from '../model/failure'

export type { PendingDrain }

export type TurnDeps = Omit<AgentTurnDeps, 'normalizeFailure' | 'failureDiagnostics'>

export class LoopTurnRunner extends AgentLoopTurnRunner {
  constructor(deps: TurnDeps) {
    super({
      ...deps,
      normalizeFailure: normalizeProviderFailure,
      failureDiagnostics: modelFailureDiagnosticsOf,
    })
  }
}
