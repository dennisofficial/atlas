import {
  assemble,
  ERunFailureKind,
  attachmentsOf,
  exchangeFaults,
  mediaFilesOf,
  resolveMediaUrls,
  UPLOAD_PLACEMENT_KIND,
  uploadPlacementsOf,
  uploadsOf,
  type MediaUrlResolver,
  type Assembled,
  type AssemblyPipeline,
  type Event,
  type ModelPort,
  type RuleContext,
  type RunId,
  type SaidMediaFile,
  type SaidUpload,
  type ThreadId,
  type UploadPlacement,
} from '@dltech/atlas-core'

import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'

import type { HookChain } from '../hooks/registry'
import type { AgentRecordPort } from '../record/agent-record.port'
import type { SaidUploadsPort } from '../uploads/said-uploads.port'
import { TurnFault } from '../model/turn-fault'
import { placeUnplacedFiles } from './place-unplaced-files'
import { faultReport } from './turn-faults'
import type { TrackedTurnDeps } from './tracked-turn-deps'

export type PreparedFailure = { kind: 'exchange'; message: string; cause: unknown }

export type PreparedStep = { ok: true; assembled: Assembled } | ({ ok: false } & PreparedFailure)

export function preparedFailureMessage(failure: PreparedFailure): {
  message: string
  cause: unknown
} {
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
  record: Pick<AgentRecordPort, 'factsOfKind' | 'appendFacts'>
  model: ModelPort
  assembly: AssemblyPipeline
  hooks: HookChain | undefined
  uploads: SaidUploadsPort | undefined
  mediaUrls?: MediaUrlResolver | undefined
  trace?: TracePort | undefined
}

export const stepPrepareDepsOf = (deps: TrackedTurnDeps): StepPrepareDeps => ({
  record: deps.record,
  model: deps.model,
  assembly: deps.assembly,
  hooks: deps.hooks,
  uploads: deps.uploads,
  mediaUrls: deps.mediaUrls,
  trace: deps.trace,
})

type FilesInEvents = {
  uploads: SaidUpload[]
  mediaFiles: SaidMediaFile[]
  current: Set<string>
}

function filesInEvents({
  events,
  threadId,
}: {
  events: readonly Event[]
  threadId: ThreadId
}): FilesInEvents {
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
  runId: RunId
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

async function placementsForStep(args: {
  deps: StepPrepareDeps
  args: StepPrepareArgs
  files: FilesInEvents
}): Promise<ReadonlyMap<string, UploadPlacement> | undefined> {
  const { deps, files } = args
  const { threadId, runId, signal } = args.args
  if (files.uploads.length === 0 && files.mediaFiles.length === 0) return undefined
  const { uploads } = deps
  if (uploads === undefined) {
    const known = uploadPlacementsOf(
      await deps.record.factsOfKind({ threadId, kind: UPLOAD_PLACEMENT_KIND }),
    )
    return known.size === 0 ? undefined : known
  }
  const placements = await placeUnplacedFiles(
    {
      record: deps.record,
      uploads,
      ...(deps.trace === undefined ? {} : { trace: deps.trace }),
    },
    {
      threadId,
      runId,
      uploads: files.uploads,
      mediaFiles: files.mediaFiles,
      currentFileIds: files.current,
      ...(signal === undefined ? {} : { signal }),
    },
  )
  return placements.size === 0 ? undefined : placements
}

async function assembleStep(deps: StepPrepareDeps, args: StepPrepareArgs): Promise<PreparedStep> {
  const files = filesInEvents({
    events: args.events,
    threadId: args.threadId,
  })
  const placements = await placementsForStep({ deps, args, files })

  const mediaUrls =
    deps.mediaUrls === undefined
      ? undefined
      : await resolveMediaUrls({
          attachments: args.events.flatMap((event) =>
            event.type === 'user-said' ? attachmentsOf(event) : [],
          ),
          threadId: args.threadId,
          resolver: deps.mediaUrls,
          ...(placements === undefined ? {} : { placements }),
        })

  const ctx: RuleContext = {
    events: args.events,
    threadId: args.threadId,
    step: args.step,
    provider: deps.model.identity,
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

  const faults = exchangeFaults(assembled)
  if (faults.length > 0) {
    return { ok: false, kind: 'exchange', message: faultReport(faults), cause: faults }
  }

  return { ok: true, assembled }
}
