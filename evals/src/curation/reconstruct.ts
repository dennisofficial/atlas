import type { CapturedFileChange } from '@dltech/atlas-core'

import { sha256Hex } from '../hash'

export enum EReconstructionKind {
  Applied = 'applied',
  AlreadyApplied = 'already_applied',
  Failed = 'failed',
}

export type Reconstruction = {
  kind: EReconstructionKind
  after: string | null
  detail?: string
}

enum EHunkOp {
  Context = ' ',
  Remove = '-',
  Add = '+',
}

type HunkLine = { op: EHunkOp; text: string }

type Hunk = {
  index: number
  oldStart: number
  newStart: number
  oldCount: number
  newCount: number
  lines: readonly HunkLine[]
  oldNoNewline: boolean
  newNoNewline: boolean
}

type ParsedDiff = { hunks: readonly Hunk[] } | { error: string }

type TextModel = { lines: readonly string[]; trailingNewline: boolean }

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const NO_NEWLINE_MARKER = '\\ No newline at end of file'
const FILE_HEADER = /^(?:diff |index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (?:from|to))/

const failed = (detail: string): Reconstruction => ({ kind: EReconstructionKind.Failed, after: null, detail })

const parseCount = (raw: string | undefined): number => (raw === undefined ? 1 : Number(raw))

function toModel({ text }: { text: string }): TextModel {
  if (text === '') return { lines: [], trailingNewline: false }
  const trailingNewline = text.endsWith('\n')
  const body = trailingNewline ? text.slice(0, -1) : text
  return { lines: body.split('\n'), trailingNewline }
}

function fromModel({ model }: { model: TextModel }): string {
  if (model.lines.length === 0) return ''
  return `${model.lines.join('\n')}${model.trailingNewline ? '\n' : ''}`
}

function opOf({ line }: { line: string }): EHunkOp | null {
  if (line.startsWith(' ')) return EHunkOp.Context
  if (line.startsWith('-')) return EHunkOp.Remove
  if (line.startsWith('+')) return EHunkOp.Add
  if (line === '') return EHunkOp.Context
  return null
}

function parseHunkBody({ header, rows, index }: { header: RegExpMatchArray; rows: readonly string[]; index: number }): Hunk | string {
  const lines: HunkLine[] = []
  let oldNoNewline = false
  let newNoNewline = false
  for (const row of rows) {
    if (row === NO_NEWLINE_MARKER) {
      const previous = lines[lines.length - 1]
      if (previous === undefined) return `hunk ${index}: no-newline marker without a preceding line`
      if (previous.op !== EHunkOp.Add) oldNoNewline = true
      if (previous.op !== EHunkOp.Remove) newNoNewline = true
      continue
    }
    const op = opOf({ line: row })
    if (op === null) return `hunk ${index}: unrecognised line "${row}"`
    lines.push({ op, text: row.slice(1) })
  }
  const oldCount = parseCount(header[2])
  const newCount = parseCount(header[4])
  const actualOld = lines.filter((line) => line.op !== EHunkOp.Add).length
  const actualNew = lines.filter((line) => line.op !== EHunkOp.Remove).length
  if (actualOld !== oldCount || actualNew !== newCount) {
    return `hunk ${index}: header counts -${oldCount} +${newCount} do not match body -${actualOld} +${actualNew}`
  }
  return {
    index,
    oldStart: Number(header[1]),
    newStart: Number(header[3]),
    oldCount,
    newCount,
    lines,
    oldNoNewline,
    newNoNewline,
  }
}

function parseDiff({ diff }: { diff: string }): ParsedDiff {
  const rows = diff.split('\n')
  if (rows[rows.length - 1] === '') rows.pop()
  const groups: { header: RegExpMatchArray; rows: string[] }[] = []
  for (const row of rows) {
    const header = row.match(HUNK_HEADER)
    if (header !== null) {
      groups.push({ header, rows: [] })
      continue
    }
    const current = groups[groups.length - 1]
    if (current === undefined) {
      if (FILE_HEADER.test(row) || row === '') continue
      return { error: `unexpected line before first hunk: "${row}"` }
    }
    current.rows.push(row)
  }
  if (groups.length === 0) return { error: 'diff has no hunks' }
  const hunks: Hunk[] = []
  for (const [position, group] of groups.entries()) {
    const hunk = parseHunkBody({ header: group.header, rows: group.rows, index: position + 1 })
    if (typeof hunk === 'string') return { error: hunk }
    hunks.push(hunk)
  }
  return { hunks }
}

function reverseHunk({ hunk }: { hunk: Hunk }): Hunk {
  const swap = (op: EHunkOp): EHunkOp => {
    if (op === EHunkOp.Add) return EHunkOp.Remove
    if (op === EHunkOp.Remove) return EHunkOp.Add
    return op
  }
  return {
    ...hunk,
    oldStart: hunk.newStart,
    newStart: hunk.oldStart,
    oldCount: hunk.newCount,
    newCount: hunk.oldCount,
    lines: hunk.lines.map((line) => ({ op: swap(line.op), text: line.text })),
    oldNoNewline: hunk.newNoNewline,
    newNoNewline: hunk.oldNoNewline,
  }
}

function applyHunks({ source, hunks }: { source: TextModel; hunks: readonly Hunk[] }): Reconstruction {
  const output: string[] = []
  let position = 0
  let trailingNewline = source.trailingNewline
  for (const hunk of hunks) {
    const start = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1
    if (start < position) return failed(`hunk ${hunk.index}: overlaps or precedes the previous hunk`)
    if (start > source.lines.length) return failed(`hunk ${hunk.index}: starts beyond the end of the file`)
    output.push(...source.lines.slice(position, start))
    position = start
    for (const line of hunk.lines) {
      if (line.op === EHunkOp.Add) {
        output.push(line.text)
        continue
      }
      if (source.lines[position] !== line.text) {
        return failed(`hunk ${hunk.index}: expected "${line.text}" at line ${position + 1}, found ${JSON.stringify(source.lines[position] ?? null)}`)
      }
      if (line.op === EHunkOp.Context) output.push(line.text)
      position += 1
    }
    if (position === source.lines.length) {
      if (hunk.oldNoNewline === source.trailingNewline) {
        return failed(`hunk ${hunk.index}: end-of-file newline state does not match the baseline`)
      }
      trailingNewline = !hunk.newNoNewline
    } else if (hunk.oldNoNewline) {
      return failed(`hunk ${hunk.index}: no-newline marker before the end of the file`)
    }
  }
  output.push(...source.lines.slice(position))
  return { kind: EReconstructionKind.Applied, after: fromModel({ model: { lines: output, trailingNewline } }) }
}

export function applyUnifiedDiff({ before, diff }: { before: string; diff: string }): Reconstruction {
  const parsed = parseDiff({ diff })
  if ('error' in parsed) return failed(parsed.error)
  const source = toModel({ text: before })
  const forward = applyHunks({ source, hunks: parsed.hunks })
  if (forward.kind === EReconstructionKind.Applied) return forward
  const reversed = applyHunks({ source, hunks: parsed.hunks.map((hunk) => reverseHunk({ hunk })) })
  if (reversed.kind === EReconstructionKind.Applied) {
    return { kind: EReconstructionKind.AlreadyApplied, after: before, detail: 'diff is already applied to the baseline' }
  }
  return forward
}

const pathFromDiff = ({ diff }: { diff: string }): string | null => {
  const header = diff.split('\n').find((row) => row.startsWith('+++ '))
  if (header === undefined) return null
  const target = header.slice(4).trim()
  if (target === '/dev/null') return null
  return target.startsWith('b/') ? target.slice(2) : target
}

export type ReconstructedChange = {
  ok: boolean
  kind: EReconstructionKind
  change: CapturedFileChange | null
  detail?: string
}

export function reconstructChange({
  before,
  diff,
  expectedAfterSha256,
  path,
}: {
  before: string | null
  diff: string
  expectedAfterSha256: string
  path?: string
}): ReconstructedChange {
  const refuse = (kind: EReconstructionKind, detail: string): ReconstructedChange => ({ ok: false, kind, change: null, detail })
  if (before === null) return refuse(EReconstructionKind.Failed, 'baseline is missing; refusing to substitute current disk content')
  const targetPath = path ?? pathFromDiff({ diff })
  if (targetPath === null) return refuse(EReconstructionKind.Failed, 'diff names no target path and none was supplied')
  const applied = applyUnifiedDiff({ before, diff })
  if (applied.kind === EReconstructionKind.Failed) return refuse(applied.kind, applied.detail ?? 'diff does not apply')
  if (applied.kind === EReconstructionKind.AlreadyApplied || applied.after === null) {
    return refuse(EReconstructionKind.AlreadyApplied, 'diff is already applied to the baseline; no change to reconstruct')
  }
  if (sha256Hex({ text: applied.after }) !== expectedAfterSha256) {
    return refuse(EReconstructionKind.Failed, 'reconstructed text does not match the expected after digest')
  }
  return { ok: true, kind: EReconstructionKind.Applied, change: { path: targetPath, before, after: applied.after } }
}
