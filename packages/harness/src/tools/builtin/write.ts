import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  AgentFileSystemPort,
  EToolEffect,
  SchemaTool,
  EQualitySkipReason,
  type DeclaredPathField,
  type QualityCoverageDiagnostic,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { LocalFileSystemPort } from '../../execution/local-filesystem'
import { writeFileAtomically } from '../../files/atomic-write'
import { FileWriteGuardPort, SerializedWrites } from '../../files/write-guard'
import { MAX_CAPTURE_SOURCE_BYTES, captureText, captureUnavailableFault, makeChange } from '../../quality/source/capture-text'
import { filePathSchema, pathEnvironmentNote, resolveToolPath } from './file-text'

const inputSchema = z.strictObject({
  path: filePathSchema,
  content: z.string(),
})

const description = [
  'Write a text file, replacing it entirely if it already exists.',
  'A relative path resolves against the project directory; missing parent directories are created.',
  pathEnvironmentNote,
  'Content is written byte for byte, so send the line endings you want the file to have.',
  'Prefer the edit tool for changing part of an existing file.',
].join(' ')

export class WriteTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'write'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields: readonly DeclaredPathField[] = [
    { field: 'path', presence: EPathPresence.Required, form: EPathForm.Absolute, content: EContentAccess.Overwrites },
  ]

  constructor(
    private readonly guard: FileWriteGuardPort = new SerializedWrites(),
    private readonly files: AgentFileSystemPort = new LocalFileSystemPort(),
  ) {
    super()
  }

  protected override async run({
    input,
    threadId,
    projectDirectory,
    captureFileChanges,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const resolved = resolveToolPath({ projectDirectory, path: input.path })
    if (!resolved.ok) return { ok: false, reason: resolved.reason }
    const path = resolved.path
    const { content } = input
    const capture = captureFileChanges === true

    const guarded = await this.guard.underLock({
      threadId,
      path,
      write: async (): Promise<ToolOutcome> => {
        const stats = await this.files.stat({ path, threadId }).catch(() => null)
        if (stats !== null && !stats.isFile()) {
          return { ok: false, reason: `${path} already exists and is not a regular file.` }
        }

        let before: string | null = null
        let captureFault: QualityCoverageDiagnostic | null = null
        if (capture && stats !== null) {
          if (stats.size > MAX_CAPTURE_SOURCE_BYTES) {
            captureFault = {
              path,
              reason: EQualitySkipReason.OversizedSource,
              detail: `previous contents are ${stats.size} bytes, past the ${MAX_CAPTURE_SOURCE_BYTES} byte capture bound`,
            }
          } else {
            const existing = await this.files.readTextForEdit({ path, threadId }).catch(() => null)
            if (existing === null) {
              captureFault = captureUnavailableFault({ path, detail: 'the previous contents could not be read' })
            } else {
              const captured = captureText({
                path,
                text: existing.text,
                strict: existing.strict,
                changed: existing.text !== content,
              })
              if (!captured.ok) captureFault = captured.diagnostic
              else before = captured.text
            }
          }
        }

        const bytes = await writeFileAtomically({ path, content, mode: stats?.mode, files: this.files, threadId })
        const created = stats === null
        const emitChange = capture && captureFault === null && (created || before !== null)

        return {
          ok: true,
          output: { path, created, bytes },
          modelText: created
            ? `File created successfully at: ${path}`
            : `The file ${path} has been updated successfully.`,
          ...(emitChange ? { fileChanges: makeChange({ path, before: created ? null : before, after: content }) } : {}),
          ...(captureFault !== null ? { fileChangeFaults: [captureFault] } : {}),
        }
      },
    })

    return guarded.ok ? guarded.value : { ok: false, reason: guarded.reason }
  }
}

