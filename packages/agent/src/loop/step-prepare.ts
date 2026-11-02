import {
  assemble,
  autoCompactBeforeStep,
  contextWindowOf,
  EAutoCompact,
  ERunFailureKind,
  exchangeFaults,
  overflowsWindow,
  type Assembled,
  type AssemblyPipeline,
  type Event,
  type ModelPort,
  type RuleContext,
  type SaidUpload,
  type ThreadId,
} from '@dltech/atlas-core'

import type { HookChain } from '../hooks/registry'
import type { SaidUploadsPort } from '../uploads/said-uploads.port'
import { TurnFault } from '../model/turn-fault'
import { faultReport, overflowReport } from './turn-faults'

export type PreparedFailure =
  | { kind: 'overflow'; tokens: number; window: number }
  | { kind: 'exchange'; message: string; cause: unknown }

export type PreparedStep =
  | { ok: true; assembled: Assembled; tokens: number }
  | { ok: true; compacted: true }
  | ({ ok: false } & PreparedFailure)

export function preparedFailureMessage(failure: PreparedFailure): {
  message: string
  cause: unknown
} {
  if (failure.kind === 'overflow') {
    const message = overflowReport(failure)
    return {
      message,
      cause: new TurnFault({
        kind: ERunFailureKind.ContextOverflow,
        message,
        detail: { tokens: failure.tokens, window: failure.window },
      }),
    }
  }
  return {
    message: failure.message,
    cause: new TurnFault({
      kind: ERunFailureKind.ExchangeFault,
      message: failure.message,
      detail: failure.cause,
    }),
  }
}

export type StepPrepareDeps = {
  model: ModelPort
  assembly: AssemblyPipeline
  countTokens: (assembled: Assembled) => number
  hooks: HookChain | undefined
  uploads: SaidUploadsPort | undefined
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

function uploadsOf({ events, threadId }: { events: readonly Event[]; threadId: ThreadId }): {
  all: SaidUpload[]
  current: Set<string>
} {
  const all: SaidUpload[] = []
  let current = new Set<string>()
  for (const event of events) {
    if (event.threadId !== threadId) continue
    if (event.type === 'assistant-said') current = new Set()
    if (event.type !== 'user-said' || event.uploads === undefined) continue
    all.push(...event.uploads)
    for (const upload of event.uploads) current.add(upload.uploadId)
  }
  return { all, current }
}

export async function prepareStepAssembly(
  deps: StepPrepareDeps,
  args: {
    threadId: ThreadId
    events: readonly Event[]
    step: number
    previous: Assembled | undefined
    signal?: AbortSignal | undefined
  },
): Promise<PreparedStep> {
  const uploads = uploadsOf({ events: args.events, threadId: args.threadId })
  const placements =
    deps.uploads === undefined || uploads.all.length === 0
      ? undefined
      : await deps.uploads.place({
          threadId: args.threadId,
          uploads: uploads.all,
          currentUploadIds: uploads.current,
          ...(args.signal === undefined ? {} : { signal: args.signal }),
        })

  const ctx: RuleContext = {
    events: args.events,
    threadId: args.threadId,
    step: args.step,
    provider: deps.model.identity,
    countTokens: deps.countTokens,
    ...(placements === undefined ? {} : { uploads: placements }),
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

  if (await deps.compact({ threadId: args.threadId, tokens, window }))
    return { ok: true, compacted: true }
  if (overflowsWindow({ tokens, window })) return { ok: false, kind: 'overflow', tokens, window }

  const faults = exchangeFaults(assembled)
  if (faults.length > 0) {
    return { ok: false, kind: 'exchange', message: faultReport(faults), cause: faults }
  }

  return { ok: true, assembled, tokens }
}
