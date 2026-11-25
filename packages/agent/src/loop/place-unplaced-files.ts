import {
  EUploadState,
  UPLOAD_PLACEMENT_KIND,
  placementFactOf,
  uploadPlacementsOf,
  type RunId,
  type SaidMediaFile,
  type SaidUpload,
  type ThreadId,
  type UploadPlacement,
} from '@dltech/atlas-core'
import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'

import type { AgentRecordPort } from '../record/agent-record.port'
import type { SaidUploadsPort } from '../uploads/said-uploads.port'

export type PlacementGateDeps = {
  record: Pick<AgentRecordPort, 'factsOfKind' | 'appendFacts'>
  uploads: SaidUploadsPort
  trace?: TracePort | undefined
}

export type PlacementGateArgs = {
  threadId: ThreadId
  runId: RunId
  uploads: readonly SaidUpload[]
  mediaFiles: readonly SaidMediaFile[]
  currentFileIds: ReadonlySet<string>
  signal?: AbortSignal | undefined
}

const uniqueBy = <T>(items: readonly T[], keyOf: (item: T) => string): T[] => [
  ...new Map(items.map((item) => [keyOf(item), item])).values(),
]

const unplacedOf = (args: {
  uploads: readonly SaidUpload[]
  mediaFiles: readonly SaidMediaFile[]
  known: ReadonlyMap<string, UploadPlacement>
}) => ({
  uploads: uniqueBy(args.uploads, (upload) => upload.uploadId).filter(
    (upload) => !args.known.has(upload.uploadId),
  ),
  mediaFiles: uniqueBy(args.mediaFiles, (file) => file.hash).filter(
    (file) => !args.known.has(file.hash),
  ),
})

const readyCountOf = (placements: ReadonlyMap<string, UploadPlacement>): number =>
  [...placements.values()].filter((placement) => placement.state === EUploadState.Ready).length

export async function placeUnplacedFiles(
  deps: PlacementGateDeps,
  args: PlacementGateArgs,
): Promise<ReadonlyMap<string, UploadPlacement>> {
  const known = uploadPlacementsOf(
    await deps.record.factsOfKind({ threadId: args.threadId, kind: UPLOAD_PLACEMENT_KIND }),
  )
  const unplaced = unplacedOf({ ...args, known })
  if (unplaced.uploads.length === 0 && unplaced.mediaFiles.length === 0) return known

  const placed = await spanWith(deps.trace, {
    name: ESpan.UploadsPlace,
    fields: {
      threadId: args.threadId,
      files: unplaced.uploads.length + unplaced.mediaFiles.length,
    },
    run: async (span) => {
      const placements = await deps.uploads.place({
        threadId: args.threadId,
        uploads: unplaced.uploads,
        mediaFiles: unplaced.mediaFiles,
        currentFileIds: args.currentFileIds,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      })
      span.set({ fetched: readyCountOf(placements) })
      return placements
    },
  })

  await deps.record.appendFacts({
    threadId: args.threadId,
    runId: args.runId,
    facts: [...placed].map(([fileId, placement]) => placementFactOf({ fileId, placement })),
  })

  return new Map([...known, ...placed])
}
