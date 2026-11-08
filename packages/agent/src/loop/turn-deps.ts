import type {
  Assembled,
  AssemblyPipeline,
  ChunkFilter,
  IdPort,
  LoopCut,
  MediaUrlResolver,
  ModelPort,
  ThreadId,
  ToolDeclaration,
} from '@dltech/atlas-core'
import type { LogPort, TracePort } from '@dltech/atlas-observability'

import type { HookChain } from '../hooks/registry'
import type { AgentIntake } from '../intake/agent-intake'
import type { ExpandContext } from '../intake/pending-said'
import type { TurnLedgerDeps } from '../ledger/record-turn-spend'
import type { ApplyLoopCut } from '../loop-cut'
import type { FailureDiagnostics, NormalizeFailure } from '../model/run-failure'
import type { AgentRecordPort, ModelContextPort } from '../record/agent-record.port'
import type { ToolDispatcher } from '../tools/dispatch'
import type { SaidUploadsPort } from '../uploads/said-uploads.port'
import type { AgentOutput } from './agent-output'
import type { LoopWatch } from './loop-watchdog'
import type { ModelWaitObserver, SleepPrevention } from './loop-ports'
import type { OnceLedger } from './once-ledger.port'
import type { RetryDeps } from './retrying-step'

export type TurnDeps = {
  record: AgentRecordPort
  modelContext: ModelContextPort
  logPort?: LogPort | undefined
  model: ModelPort
  ids: IdPort
  assembly: AssemblyPipeline
  tools?: (() => readonly ToolDeclaration[]) | undefined
  countTokens?: ((assembled: Assembled) => number) | undefined
  onChunk?: ChunkFilter | undefined
  output?: AgentOutput | undefined
  dispatch?: ToolDispatcher | undefined
  hooks?: HookChain | undefined
  uploads?: SaidUploadsPort | undefined
  mediaUrls?: MediaUrlResolver | undefined
  intake?: AgentIntake | undefined
  expandContext?: ExpandContext | undefined
  spend?: TurnLedgerDeps | undefined
  compact?: ((args: { threadId: ThreadId }) => Promise<boolean>) | undefined
  applyLoopCut?: ApplyLoopCut | undefined
  onLoopCut?: ((cut: LoopCut) => void) | undefined
  watchLoop?: LoopWatch | undefined
  onLoopWatch?: (() => void) | undefined
  onLoopWatchCut?: ((args: { steps: number }) => void) | undefined
  onLoopStop?: (() => void) | undefined
  autoCompactAtPercent?: (() => number) | undefined
  launchDirectory: string
  retry?: RetryDeps | undefined
  sleepPrevention?: SleepPrevention | undefined
  waitState?: ModelWaitObserver | undefined
  detachTool?: ((name: string) => boolean) | undefined
  normalizeFailure: NormalizeFailure
  failureDiagnostics?: FailureDiagnostics | undefined
  onceLedger?: OnceLedger | undefined
  trace?: TracePort | undefined
}
