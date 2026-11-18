import { EFileChange, type ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'
import type { DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'
import { EChangeFileStatus, type ChangedFile as ChangedFileEntry } from '@dltech/atlas-protocol'

const CHANGE_OF_STATUS: Record<EChangeFileStatus, EFileChange> = {
  [EChangeFileStatus.Added]: EFileChange.Added,
  [EChangeFileStatus.Modified]: EFileChange.Modified,
  [EChangeFileStatus.Deleted]: EFileChange.Deleted,
}

export type FileDiff = { lines: DiffLine[] }

export type WorkingTreeFile = {
  path: string
  oldPath: string | null
  change: EFileChange
  added: number
  removed: number
  binary: boolean
  size: number | null
}

export const changeOfStatus = (status: EChangeFileStatus): EFileChange => CHANGE_OF_STATUS[status]

export const workingTreeFileOf = (file: ChangedFileEntry): WorkingTreeFile => ({
  path: file.path,
  oldPath: file.oldPath,
  change: changeOfStatus(file.status),
  added: file.additions,
  removed: file.deletions,
  binary: file.binary,
  size: file.size,
})

export const rowsOf = (
  file: ChangedFileEntry,
): Pick<ChangedFile, 'path' | 'added' | 'removed' | 'change'> => ({
  path: file.path,
  added: file.additions,
  removed: file.deletions,
  change: changeOfStatus(file.status),
})

export function changedFilesOf(args: {
  files: readonly ChangedFileEntry[]
  diffs: ReadonlyMap<string, FileDiff>
}): ChangedFile[] {
  return args.files.map((file) => {
    const diff = args.diffs.get(file.path)
    const row = rowsOf(file)
    if (diff === undefined) return row
    return { ...row, lines: diff.lines }
  })
}

export const renameLabel = (file: WorkingTreeFile): string | null =>
  file.oldPath === null || file.oldPath === file.path ? null : `${file.oldPath} → ${file.path}`

export function byteSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`
  return `${(kilobytes / 1024).toFixed(1)} MB`
}

export const binaryLabel = (file: WorkingTreeFile): string =>
  file.size === null ? 'Binary file' : `Binary file — ${byteSizeLabel(file.size)}`
