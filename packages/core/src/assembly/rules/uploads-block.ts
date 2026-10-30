import { systemContext } from '../../context/envelope'
import type { SaidUpload } from '../../events/body'
import { EUploadState, type UploadPlacement } from '../../uploads/placement'
import { uploadPathOf } from '../../uploads/paths'

const UNITS = ['B', 'KB', 'MB', 'GB']
const STEP = 1024

function sizeLabel(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP
    unit += 1
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[unit]}`
}

function lineOf({
  upload,
  placement,
}: {
  upload: SaidUpload
  placement: UploadPlacement | undefined
}): string {
  if (placement?.state === EUploadState.Missing) return `- ${upload.name}: no longer available`
  const path = placement?.state === EUploadState.Ready ? placement.path : uploadPathOf(upload)
  return `- ${path} (${sizeLabel(upload.size)}, ${upload.mediaType})`
}

export function uploadsBlock({
  uploads,
  placements,
}: {
  uploads: readonly SaidUpload[]
  placements: ReadonlyMap<string, UploadPlacement> | undefined
}): string {
  const lines = uploads.map((upload) =>
    lineOf({ upload, placement: placements?.get(upload.uploadId) }),
  )
  return systemContext({
    slot: 'uploads',
    key: 'uploads',
    content: ['The operator attached these files:', ...lines].join('\n'),
  })
}
