import {
  EChangeStatus,
  EDiffLineKind,
  type ChangedFileWire,
  type DiffHunkWire,
  type DiffLineWire,
} from '@dltech/atlas-wire'

export const MAX_LINES_PER_FILE = 1500

const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const DEVNULL = '/dev/null'

type Draft = {
  path: string
  oldPath: string | undefined
  status: EChangeStatus
  binary: boolean
  additions: number
  deletions: number
  hunks: DiffHunkWire[]
  lines: DiffLineWire[] | null
  kept: number
  truncated: boolean
  oldNumber: number
  newNumber: number
}

const unquoted = (path: string): string =>
  path.length > 1 && path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path

const draftFor = (header: RegExpExecArray): Draft => ({
  path: unquoted(header[2] ?? ''),
  oldPath: undefined,
  status: EChangeStatus.Modified,
  binary: false,
  additions: 0,
  deletions: 0,
  hunks: [],
  lines: null,
  kept: 0,
  truncated: false,
  oldNumber: 0,
  newNumber: 0,
})

const finished = (draft: Draft): ChangedFileWire => ({
  path: draft.path,
  ...(draft.oldPath === undefined ? {} : { oldPath: draft.oldPath }),
  status: draft.status,
  additions: draft.additions,
  deletions: draft.deletions,
  binary: draft.binary,
  truncated: draft.truncated,
  hunks: draft.hunks,
})

const readMetadata = (args: { draft: Draft; line: string }): boolean => {
  const { draft, line } = args
  if (line.startsWith('new file mode')) draft.status = EChangeStatus.Added
  else if (line.startsWith('deleted file mode')) draft.status = EChangeStatus.Deleted
  else if (line.startsWith('rename from ')) draft.oldPath = unquoted(line.slice(12))
  else if (line.startsWith('rename to ')) draft.path = unquoted(line.slice(10))
  else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch'))
    draft.binary = true
  else if (line.startsWith('--- ')) {
    if (line.slice(4) === DEVNULL) draft.status = EChangeStatus.Added
  } else if (line.startsWith('+++ ')) {
    if (line.slice(4) === DEVNULL) draft.status = EChangeStatus.Deleted
  } else return false
  return true
}

const keep = (args: { draft: Draft; line: DiffLineWire }): void => {
  const { draft } = args
  if (draft.kept >= MAX_LINES_PER_FILE) {
    draft.truncated = true
    return
  }
  draft.kept += 1
  draft.lines?.push(args.line)
}

const readBody = (args: { draft: Draft; line: string }): void => {
  const { draft, line } = args
  const hunk = HUNK_HEADER.exec(line)
  if (hunk !== null) {
    draft.oldNumber = Number(hunk[1])
    draft.newNumber = Number(hunk[2])
    draft.lines = []
    draft.hunks.push({ header: line, lines: draft.lines })
    return
  }
  if (draft.lines === null || line.startsWith('\\')) return

  const sign = line[0]
  const text = line.slice(1)
  if (sign === '+') {
    draft.additions += 1
    keep({ draft, line: { kind: EDiffLineKind.Add, text, newNumber: draft.newNumber } })
    draft.newNumber += 1
  } else if (sign === '-') {
    draft.deletions += 1
    keep({ draft, line: { kind: EDiffLineKind.Remove, text, oldNumber: draft.oldNumber } })
    draft.oldNumber += 1
  } else if (sign === ' ') {
    keep({
      draft,
      line: {
        kind: EDiffLineKind.Context,
        text,
        oldNumber: draft.oldNumber,
        newNumber: draft.newNumber,
      },
    })
    draft.oldNumber += 1
    draft.newNumber += 1
  }
}

export const parseUnifiedDiff = (diff: string): ChangedFileWire[] => {
  const files: ChangedFileWire[] = []
  let draft: Draft | null = null

  for (const line of diff.split('\n')) {
    const header = FILE_HEADER.exec(line)
    if (header !== null) {
      if (draft !== null) files.push(finished(draft))
      draft = draftFor(header)
      continue
    }
    if (draft === null) continue
    if (draft.lines === null && readMetadata({ draft, line })) continue
    readBody({ draft, line })
  }

  if (draft !== null) files.push(finished(draft))
  return files
}
