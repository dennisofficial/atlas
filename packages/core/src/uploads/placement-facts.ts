import { z } from 'zod'

import type { RecordBody } from '../record/event'
import { EUploadState, type UploadPlacement } from './placement'

export const UPLOAD_PLACEMENT_KIND = 'upload-placement'

const PLACEMENT_KEY_PREFIX = 'upload:'

export type FactRecord = { type: 'fact-recorded'; key: string; kind: string; value?: unknown }

export type FactDraft = Extract<RecordBody, { type: 'fact-recorded' }>

const placementValueSchema: z.ZodType<UploadPlacement> = z.union([
  z.object({ state: z.literal(EUploadState.Ready), path: z.string().min(1) }),
  z.object({ state: z.literal(EUploadState.Missing) }),
])

export const uploadPlacementKeyOf = (fileId: string): string => `${PLACEMENT_KEY_PREFIX}${fileId}`

export const uploadFileIdOf = (key: string): string | undefined =>
  key.startsWith(PLACEMENT_KEY_PREFIX) ? key.slice(PLACEMENT_KEY_PREFIX.length) : undefined

export const uploadPlacementsOf = (
  facts: readonly FactRecord[],
): ReadonlyMap<string, UploadPlacement> => {
  const placements = new Map<string, UploadPlacement>()
  for (const fact of facts) {
    if (fact.type !== 'fact-recorded' || fact.kind !== UPLOAD_PLACEMENT_KIND) continue
    const fileId = uploadFileIdOf(fact.key)
    if (fileId === undefined || fileId.length === 0) continue
    const placement = placementValueSchema.safeParse(fact.value)
    if (placement.success) placements.set(fileId, placement.data)
  }
  return placements
}

export const placementFactOf = (args: {
  fileId: string
  placement: UploadPlacement
}): FactDraft => ({
  type: 'fact-recorded',
  key: uploadPlacementKeyOf(args.fileId),
  kind: UPLOAD_PLACEMENT_KIND,
  value: args.placement,
})
