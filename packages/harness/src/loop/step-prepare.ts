import {
  assemble,
  autoCompactBeforeStep,
  contextWindowOf,
  EAutoCompact,
  exchangeFaults,
  overflowsWindow,
  type Assembled,
  type AssemblyPipeline,
  type Event,
  type ModelPort,
  type RuleContext,
  type ThreadId,
} from '@dltech/atlas-core'

import type { HookChain } from '../hooks/registry'
import { faultReport, overflowReport } from './turn-faults'

export type PreparedFailure =
  | { kind: 'overflow'; tokens: number; window: number }
  | { kind: 'exchange'; message: string; cause: unknown }

export type PreparedStep =
  | { ok: true; assembled: Assembled; tokens: number }
  | { ok: true; compacted: true }
  | ({ ok: false } & PreparedFailure)

export function preparedFailureMessage(failure: PreparedFailure): { message: string; cause: unknown } {
  if (failure.kind === 'overflow') {
    return { message: overflowReport(failure), cause: { tokens: failure.tokens, window: failure.window } }
  }
  return { message: failure.message, cause: failure.cause }
}

export type StepPrepareDeps = {
  model: ModelPort
  assembly: AssemblyPipeline
  countTokens: (assembled: Assembled) => number
  hooks: HookChain | undefined
  onContext: ((args: { tokens: number; window: number }) => void) | undefined
  compact: (args: { threadId: ThreadId; tokens: number; window: number }) => Promise<boolean>
}

export function oncePerTurnCompact({
  compact,
  atPercent,
  position,
}: {
  compact: ((args: { threadId: ThreadId }) => Promise<boolean>) | undefined
  atPercent: () => number
  position: { compacted: boolean }
}): StepPrepareDeps['compact'] {
  return async ({ threadId, tokens, window }) => {
    if (position.compacted || compact === undefined) return false
    if (
      autoCompactBeforeStep({ tokens, window, atPercent: atPercent() }) !==
      EAutoCompact.BeforeOverflow
    ) {
      return false
    }
    position.compacted = true
    return compact({ threadId })
  }
}

export async function prepareStepAssembly(
  deps: StepPrepareDeps,
  args: {
    threadId: ThreadId
    events: readonly Event[]
    step: number
    previous: Assembled | undefined
  },
): Promise<PreparedStep> {
  const ctx: RuleContext = {
    events: args.events,
    threadId: args.threadId,
    step: args.step,
    provider: deps.model.identity,
    countTokens: deps.countTokens,
    ...(args.previous === undefined ? {} : { previous: args.previous }),
  }

  const { assembled: projected, trace } = assemble({
    rules: deps.assembly.rules,
    annotators: deps.assembly.annotators,
    ctx,
  })

  const assembled = (await deps.hooks?.beforeStep({ assembled: projected, trace })) ?? projected

  const tokens = deps.countTokens(assembled)
  const window = contextWindowOf(deps.model)
  deps.onContext?.({ tokens, window })

  if (await deps.compact({ threadId: args.threadId, tokens, window })) return { ok: true, compacted: true }
  if (overflowsWindow({ tokens, window })) return { ok: false, kind: 'overflow', tokens, window }

  const faults = exchangeFaults(assembled)
  if (faults.length > 0) {
    return { ok: false, kind: 'exchange', message: faultReport(faults), cause: faults }
  }

  return { ok: true, assembled, tokens }
}
