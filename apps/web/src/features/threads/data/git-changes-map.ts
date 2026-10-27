import {
  EFileChange,
  type ChangedFile,
  type ChangeScopeOption,
} from '@dltech/atlas-ui/ai/changes-panel'
import type { DiffLine, DiffLineKind } from '@dltech/atlas-ui/ai/diff-viewer'
import {
  EChangeScope,
  EChangeStatus,
  EDiffLineKind,
  type ChangedFileWire,
  type DiffHunkWire,
  type DiffLineWire,
} from '@dltech/atlas-wire/web'

export const CHANGE_SCOPES: ChangeScopeOption[] = [
  {
    id: EChangeScope.All,
    label: 'All changes',
    detail: 'since the branch point',
  },
  {
    id: EChangeScope.Uncommitted,
    label: 'Uncommitted',
    detail: 'working tree',
  },
  { id: EChangeScope.LastCommit, label: 'Last commit', detail: 'HEAD' },
]

export function changeScopeOf(id: string): EChangeScope | undefined {
  return Object.values(EChangeScope).find((scope) => scope === id)
}

const CHANGE_OF_STATUS: Record<EChangeStatus, EFileChange> = {
  [EChangeStatus.Added]: EFileChange.Added,
  [EChangeStatus.Modified]: EFileChange.Modified,
  [EChangeStatus.Deleted]: EFileChange.Deleted,
}

const KIND_OF_WIRE: Record<EDiffLineKind, DiffLineKind> = {
  [EDiffLineKind.Add]: 'add',
  [EDiffLineKind.Remove]: 'remove',
  [EDiffLineKind.Context]: 'context',
}

export const TRUNCATED_DIFF_TEXT = 'Diff truncated'

const lineOf = (line: DiffLineWire): DiffLine => ({
  kind: KIND_OF_WIRE[line.kind],
  text: line.text,
  ...(line.oldNumber === undefined ? {} : { oldNumber: line.oldNumber }),
  ...(line.newNumber === undefined ? {} : { newNumber: line.newNumber }),
})

const lastOldNumber = (hunk: DiffHunkWire): number | undefined =>
  hunk.lines.findLast((line) => line.oldNumber !== undefined)?.oldNumber

const firstOldNumber = (hunk: DiffHunkWire): number | undefined =>
  hunk.lines.find((line) => line.oldNumber !== undefined)?.oldNumber

function gapText(args: { before: DiffHunkWire; after: DiffHunkWire }): string {
  const end = lastOldNumber(args.before)
  const start = firstOldNumber(args.after)
  if (end === undefined || start === undefined) return args.after.header
  const hidden = start - end - 1
  if (hidden <= 0) return args.after.header
  return `${hidden} unchanged ${hidden === 1 ? 'line' : 'lines'}`
}

export function diffLinesOf(file: ChangedFileWire): DiffLine[] {
  const lines = file.hunks.flatMap((hunk, index): DiffLine[] => {
    const before = file.hunks[index - 1]
    const gap: DiffLine[] =
      before === undefined ? [] : [{ kind: 'gap', text: gapText({ before, after: hunk }) }]
    return [...gap, ...hunk.lines.map(lineOf)]
  })
  return file.truncated ? [...lines, { kind: 'gap', text: TRUNCATED_DIFF_TEXT }] : lines
}

export function changedFileOf(file: ChangedFileWire): ChangedFile {
  const header = file.hunks[0]?.header
  return {
    path: file.path,
    added: file.additions,
    removed: file.deletions,
    change: CHANGE_OF_STATUS[file.status],
    ...(header === undefined ? {} : { hunk: header }),
    ...(file.binary ? {} : { lines: diffLinesOf(file) }),
  }
}

export function changedFilesOf(files: readonly ChangedFileWire[]): ChangedFile[] {
  return files.map(changedFileOf)
}

export function changeByPath(files: readonly ChangedFile[]): ReadonlyMap<string, EFileChange> {
  return new Map(files.map((file) => [file.path, file.change]))
}
