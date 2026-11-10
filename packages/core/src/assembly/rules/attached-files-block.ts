import type { SaidMediaFile } from '../../attachments/media-files'
import type { SaidUpload } from '../../attachments/legacy-said'
import { systemContext } from '../../context/envelope'
import { uploadPathOf } from '../../uploads/paths'
import { EUploadState, type UploadPlacement } from '../../uploads/placement'

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

type AttachedFile = { id: string; name: string; size: number; mediaType: string }

const uploadFileOf = (upload: SaidUpload): AttachedFile => ({
  id: upload.uploadId,
  name: upload.name,
  size: upload.size,
  mediaType: upload.mediaType,
})

const mediaFileOf = (file: SaidMediaFile): AttachedFile => ({
  id: file.hash,
  name: file.name,
  size: file.size,
  mediaType: file.mediaType,
})

function lineOf({
  file,
  placements,
}: {
  file: AttachedFile
  placements: ReadonlyMap<string, UploadPlacement> | undefined
}): string {
  const placement = placements?.get(file.id)
  if (placement?.state === EUploadState.Missing) return `- ${file.name}: no longer available`
  const path =
    placement?.state === EUploadState.Ready
      ? placement.path
      : uploadPathOf({ fileId: file.id, name: file.name })
  return `- ${path} (${sizeLabel(file.size)}, ${file.mediaType})`
}

export function attachedFilesBlock({
  uploads,
  mediaFiles,
  placements,
}: {
  uploads: readonly SaidUpload[]
  mediaFiles: readonly SaidMediaFile[]
  placements: ReadonlyMap<string, UploadPlacement> | undefined
}): string {
  const files = [...uploads.map(uploadFileOf), ...mediaFiles.map(mediaFileOf)]
  const lines = files.map((file) => lineOf({ file, placements }))
  return systemContext({
    slot: 'uploads',
    key: 'uploads',
    content: ['The operator attached these files:', ...lines].join('\n'),
  })
}
