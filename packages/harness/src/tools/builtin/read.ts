import {
  AgentFileSystemPort,
  EContentAccess,
  EPathForm,
  EPathPresence,
  EToolEffect,
  imageMediaType,
  SchemaTool,
  type DeclaredPathField,
  type ToolOutcome,
  type ToolRun,
  type WholeFileClaim,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { LocalFileSystemPort } from '../../execution/local-filesystem'
import { filePathSchema, pathEnvironmentNote, resolveToolPath } from './file-text'
import { missingPathReason } from './missing-path'
import { readImage } from './read-image'

const MAX_READ_BYTES = 262_144

const DEFAULT_LINE_LIMIT = 2_000

const MAX_LINE_CHARS = 2_000

const BINARY_SNIFF_LENGTH = 4096

const NUL_BYTE = 0

const inputSchema = z.strictObject({
  path: filePathSchema,
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).optional(),
})

const description = [
  'Read a file from the filesystem.',
  'A relative path resolves against the project directory.',
  pathEnvironmentNote,
  'A PNG, JPEG, GIF or WebP file comes back as a picture you can look at, provided it is small enough to send.',
  'Output is line-numbered, tab-separated, one line per file line.',
  'Use offset to start at a given 1-based line and limit to cap how many lines come back.',
  `At most ${DEFAULT_LINE_LIMIT} lines come back at a time and each line is clipped at ${MAX_LINE_CHARS} characters;`,
  'when that happens the result says so and names the line to resume from.',
  'Use grep to find what you need in a file too large to take in one read.',
].join(' ')

export type ReadOutput = { path: string; lines: number; truncated: boolean }

const isReadOutput = (output: unknown): output is ReadOutput =>
  typeof output === 'object' &&
  output !== null &&
  'truncated' in output &&
  typeof (output as ReadOutput).truncated === 'boolean'

enum EScan {
  Selected = 'selected',
  PastEnd = 'past-end',
}

enum EStop {
  EndOfFile = 'end-of-file',
  LineLimit = 'line-limit',
  ByteLimit = 'byte-limit',
}

type Selection = {
  kind: EScan.Selected
  lines: string[]
  stop: EStop
  clipped: number
  nextLine: number
}

type LineScan = Selection | { kind: EScan.PastEnd; totalLines: number }

const withoutCarriageReturn = (line: string): string =>
  line.endsWith('\r') ? line.slice(0, -1) : line

function linesOf(content: string): string[] {
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map(withoutCarriageReturn)
}

function scanLines(args: {
  content: string
  firstLine: number
  limit: number
}): LineScan {
  const lines: string[] = []
  let lineNumber = 0
  let bytes = 0
  let clipped = 0

  for (const line of linesOf(args.content)) {
    lineNumber += 1
    if (lineNumber < args.firstLine) continue

    if (lines.length >= args.limit) {
      return { kind: EScan.Selected, lines, stop: EStop.LineLimit, clipped, nextLine: lineNumber }
    }

    const kept = line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line
    if (kept.length < line.length) clipped += 1

    bytes += Buffer.byteLength(kept, 'utf8') + 1
    if (bytes > MAX_READ_BYTES && lines.length > 0) {
      return { kind: EScan.Selected, lines, stop: EStop.ByteLimit, clipped, nextLine: lineNumber }
    }

    lines.push(kept)
  }

  if (lines.length === 0) return { kind: EScan.PastEnd, totalLines: lineNumber }

  return { kind: EScan.Selected, lines, stop: EStop.EndOfFile, clipped, nextLine: lineNumber + 1 }
}

const utf8Decoder = new TextDecoder()

const resumeAt = (nextLine: number): string =>
  `Read on with offset ${nextLine}, or use grep to jump to what you need.`

function noticeFor(args: { path: string; scan: Selection }): string | undefined {
  const { path, scan } = args
  const notes: string[] = []

  if (scan.stop === EStop.LineLimit) {
    notes.push(`Stopped after ${scan.lines.length} lines. ${resumeAt(scan.nextLine)}`)
  }
  if (scan.stop === EStop.ByteLimit) {
    notes.push(
      `Stopped at the ${MAX_READ_BYTES} byte limit after ${scan.lines.length} lines. ${resumeAt(scan.nextLine)}`,
    )
  }
  if (scan.clipped === 1) {
    notes.push(
      `1 line ran past ${MAX_LINE_CHARS} characters and was clipped, so ${path} is not shown in full.`,
    )
  }
  if (scan.clipped > 1) {
    notes.push(
      `${scan.clipped} lines ran past ${MAX_LINE_CHARS} characters and were clipped, so ${path} is not shown in full.`,
    )
  }

  return notes.length === 0 ? undefined : notes.join(' ')
}

export type ReadToolArgs = {
  files?: AgentFileSystemPort | undefined
}

export class ReadTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'read'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  override readonly revealsWholeFile = ({
    input,
    output,
  }: WholeFileClaim<z.output<typeof inputSchema>>): boolean =>
    input.offset === undefined &&
    input.limit === undefined &&
    isReadOutput(output) &&
    !output.truncated
  readonly inputSchema = inputSchema
  override readonly pathFields: readonly DeclaredPathField[] = [
    { field: 'path', presence: EPathPresence.Required, form: EPathForm.Absolute, content: EContentAccess.Reads },
  ]

  private readonly files: AgentFileSystemPort

  constructor(args: ReadToolArgs = {}) {
    super()
    this.files = args.files ?? new LocalFileSystemPort()
  }

  protected override async run({
    input,
    projectDirectory,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const rawPath = input.path
    const resolved = resolveToolPath({ projectDirectory, path: rawPath })
    if (!resolved.ok) return { ok: false, reason: resolved.reason }
    const path = resolved.path
    const { offset, limit } = input
    const stats = await this.files.stat({ path, threadId }).catch(() => null)
    if (stats === null) {
      return {
        ok: false,
        reason: await missingPathReason({
          path,
          ...(resolved.anchored ? { resolvedFrom: { raw: rawPath, projectDirectory } } : {}),
        }),
      }
    }
    if (stats.isDirectory()) {
      return { ok: false, reason: `${path} is a directory; use glob or grep to inspect its contents.` }
    }
    if (!stats.isFile()) return { ok: false, reason: `${path} is not a regular file.` }

    const bytes = await this.files.readBytes({ path, threadId })
    const head = bytes.subarray(0, BINARY_SNIFF_LENGTH)

    const mediaType = imageMediaType(head)
    if (mediaType !== null) {
      return await readImage({
        path,
        mediaType,
        byteLength: stats.size,
        head,
        files: this.files,
        threadId,
      })
    }

    if (head.includes(NUL_BYTE)) {
      return { ok: false, reason: `${path} looks like a binary file and cannot be read as text.` }
    }

    const firstLine = offset ?? 1
    const scan = scanLines({
      content: utf8Decoder.decode(bytes),
      firstLine,
      limit: limit ?? DEFAULT_LINE_LIMIT,
    })

    if (scan.kind === EScan.PastEnd) {
      return {
        ok: true,
        output: { path, lines: 0, truncated: scan.totalLines > 0 } satisfies ReadOutput,
        modelText:
          scan.totalLines === 0
            ? `${path} exists but is empty.`
            : `${path} has ${scan.totalLines} lines; line ${firstLine} is past the end of the file.`,
      }
    }

    const notice = noticeFor({ path, scan })
    const numbered = scan.lines.map((line, index) => `${firstLine + index}\t${line}`).join('\n')

    return {
      ok: true,
      output: {
        path,
        lines: scan.lines.length,
        truncated: firstLine > 1 || scan.stop !== EStop.EndOfFile || scan.clipped > 0,
      } satisfies ReadOutput,
      modelText: notice === undefined ? numbered : `${numbered}\n\n${notice}`,
    }
  }
}
