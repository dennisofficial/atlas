import {
  assemble,
  autoCompactBeforeStep,
  contextWindowOf,
  EAutoCompact,
  ERunFailureKind,
  attachmentsOf,
  exchangeFaults,
  mediaFilesOf,
  resolveMediaUrls,
  type MediaUrlResolver,
  overflowsWindow,
  uploadsOf,
  type Assembled,
  type AssemblyPipeline,
  type Event,
  type ModelPort,
  type RuleContext,
  type SaidMediaFile,
  type SaidUpload,
  type ThreadId,
} from '@dltech/atlas-core'

import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'

import type { HookChain } from '../hooks/registry'
import type { SaidUploadsPort } from '../uploads/said-uploads.port'
import { TurnFault } from '../model/turn-fault'
import { faultReport, overflowReport } from './turn-faults'
import type { TrackedTurnDeps } from './tracked-turn-deps'

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
  mediaUrls?: MediaUrlResolver | undefined
  onContext: ((args: { tokens: number; window: number }) => void) | undefined
  compact: (args: { threadId: ThreadId; tokens: number; window: number }) => Promise<boolean>
  trace?: TracePort | undefined
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

export const stepPrepareDepsOf = ({
  deps,
  position,
}: {
  deps: TrackedTurnDeps
  position: { compacted: boolean }
}): StepPrepareDeps => ({
  model: deps.model,
  assembly: deps.assembly,
  countTokens: deps.countTokens,
  hooks: deps.hooks,
  uploads: deps.uploads,
  mediaUrls: deps.mediaUrls,
  onContext: deps.onContext,
  trace: deps.trace,
  compact: oncePerTurnCompact({
    compact: deps.compact,
    atPercent: deps.autoCompactAtPercent,
    position,
  }),
})

function filesInEvents({ events, threadId }: { events: readonly Event[]; threadId: ThreadId }): {
  uploads: SaidUpload[]
  mediaFiles: SaidMediaFile[]
  current: Set<string>
} {
  const uploads: SaidUpload[] = []
  const mediaFiles: SaidMediaFile[] = []
  const seenMedia = new Set<string>()
  let current = new Set<string>()
  for (const event of events) {
    if (event.threadId !== threadId) continue
    if (event.type === 'assistant-said') current = new Set()
    if (event.type !== 'user-said') continue
    const attachments = attachmentsOf(event)
    for (const file of mediaFilesOf(attachments)) {
      if (!seenMedia.has(file.hash)) mediaFiles.push(file)
      seenMedia.add(file.hash)
      current.add(file.hash)
    }
    const found = uploadsOf(attachments)
    uploads.push(...found)
    for (const upload of found) current.add(upload.uploadId)
  }
  return { uploads, mediaFiles, current }
}

type StepPrepareArgs = {
  threadId: ThreadId
  events: readonly Event[]
  step: number
  previous: Assembled | undefined
  signal?: AbortSignal | undefined
}

export function prepareStepAssembly(
  deps: StepPrepareDeps,
  args: StepPrepareArgs,
): Promise<PreparedStep> {
  return spanWith(deps.trace, {
    name: ESpan.ContextPrepare,
    fields: { threadId: args.threadId, step: args.step },
    run: () => assembleStep(deps, args),
  })
}

async function assembleStep(deps: StepPrepareDeps, args: StepPrepareArgs): Promise<PreparedStep> {
  const files = filesInEvents({
    events: args.events,
    threadId: args.threadId,
  })
  const placements =
    deps.uploads === undefined || (files.uploads.length === 0 && files.mediaFiles.length === 0)
      ? undefined
      : await deps.uploads.place({
          threadId: args.threadId,
          uploads: files.uploads,
          mediaFiles: files.mediaFiles,
          currentFileIds: files.current,
          ...(args.signal === undefined ? {} : { signal: args.signal }),
        })

  const mediaUrls =
    deps.mediaUrls === undefined
      ? undefined
      : await resolveMediaUrls({
          attachments: args.events.flatMap((event) =>
            event.type === 'user-said' ? attachmentsOf(event) : [],
          ),
          threadId: args.threadId,
          resolver: deps.mediaUrls,
        })

  const ctx: RuleContext = {
    events: args.events,
    threadId: args.threadId,
    step: args.step,
    provider: deps.model.identity,
    countTokens: deps.countTokens,
    imageCapabilities: deps.model.traits?.().image,
    ...(mediaUrls === undefined ? {} : { mediaUrls }),
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
