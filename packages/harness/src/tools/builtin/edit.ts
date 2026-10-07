import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  AgentFileSystemPort,
  EToolEffect,
  SchemaTool,
  type ThreadId,
  type DeclaredPathField,
  type QualityCoverageDiagnostic,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { LocalFileSystemPort } from '../../execution/local-filesystem'
import { writeFileAtomically } from '../../files/atomic-write'
import { FileWriteGuardPort, SerializedWrites } from '../../files/write-guard'
import { captureText, captureUnavailableFault, makeChange } from '../../quality/source/capture-text'
import { filePathSchema, pathEnvironmentNote, resolveToolPath, toLf } from './file-text'
import { replaceInContent } from './replace-text'
import { renderUnifiedDiff } from './unified-diff'

const inputSchema = z.strictObject({
  path: filePathSchema,
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().optional(),
})

const description = [
  'Replace an exact string in a text file.',
  'A relative path resolves against the project directory.',
  pathEnvironmentNote,
  'oldString must match the file exactly, including indentation, and must be unique unless replaceAll is true.',
  'An empty oldString creates the file with newString as its whole content.',
  'Lines the edit does not touch keep their exact bytes, line endings included.',
].join(' ')

const updated = (path: string): string => `The file ${path} has been updated successfully.`

const created = (path: string): string => `File created successfully at: ${path}`

async function createFile(args: {
  path: string
  newString: string
  existing: string | null
  mode: number | undefined
  files: AgentFileSystemPort
  threadId: ThreadId
  capture: boolean
  captureFault: QualityCoverageDiagnostic | null
  capturedBefore: string | null
}): Promise<ToolOutcome> {
  if (args.newString === '') {
    return {
      ok: false,
      reason:
        'An empty oldString with an empty newString names nothing to replace and nothing to write. Use the write tool with an empty content to create or empty a file.',
    }
  }

  if (args.existing !== null && args.existing.trim() !== '') {
    return { ok: false, reason: 'Cannot create new file - file already exists.' }
  }

  await writeFileAtomically({
    path: args.path,
    content: args.newString,
    mode: args.mode,
    files: args.files,
    threadId: args.threadId,
  })

  return {
    ok: true,
    output: {
      path: args.path,
      diff: renderUnifiedDiff({
        path: args.path,
        oldContent: args.existing,
        newContent: args.newString,
      }),
    },
    modelText: args.existing === null ? created(args.path) : updated(args.path),
    ...(args.capture && args.captureFault === null
      ? { fileChanges: makeChange({ path: args.path, before: args.capturedBefore, after: args.newString }) }
      : {}),
    ...(args.captureFault !== null ? { fileChangeFaults: [args.captureFault] } : {}),
  }
}

async function replaceInFile(args: {
  path: string
  oldString: string
  newString: string
  replaceAll: boolean
  mode: number
  files: AgentFileSystemPort
  threadId: ThreadId
  capture: boolean
}): Promise<ToolOutcome> {
  let raw: string
  let captureFault: QualityCoverageDiagnostic | null = null
  let before: string | null = null
  if (args.capture) {
    const read = await args.files.readTextForEdit({ path: args.path, threadId: args.threadId })
    raw = read.text
    const captured = captureText({ path: args.path, text: read.text, strict: read.strict, changed: true })
    if (!captured.ok) captureFault = captured.diagnostic
    else before = captured.text
  } else {
    raw = await args.files.readFile({ path: args.path, threadId: args.threadId })
  }

  const replaced = replaceInContent({
    content: raw,
    oldString: args.oldString,
    newString: args.newString,
    replaceAll: args.replaceAll,
  })
  if (!replaced.ok) return { ok: false, reason: replaced.reason }

  await writeFileAtomically({
    path: args.path,
    content: replaced.content,
    mode: args.mode,
    files: args.files,
    threadId: args.threadId,
  })

  return {
    ok: true,
    output: {
      path: args.path,
      diff: renderUnifiedDiff({
        path: args.path,
        oldContent: toLf(raw),
        newContent: toLf(replaced.content),
      }),
    },
    modelText: updated(args.path),
    ...(args.capture && captureFault === null && before !== null
      ? { fileChanges: makeChange({ path: args.path, before, after: replaced.content }) }
      : {}),
    ...(captureFault !== null ? { fileChangeFaults: [captureFault] } : {}),
  }
}

export class EditTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'edit'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields: readonly DeclaredPathField[] = [
    { field: 'path', presence: EPathPresence.Required, form: EPathForm.Absolute, content: EContentAccess.Amends },
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
    const { oldString, newString, replaceAll } = input
    const capture = captureFileChanges === true

    const guarded = await this.guard.underLock({
      threadId,
      path,
      write: async (): Promise<ToolOutcome> => {
        const stats = await this.files.stat({ path, threadId }).catch(() => null)
        if (stats !== null && !stats.isFile()) {
          return { ok: false, reason: `${path} is not a regular file.` }
        }

        if (oldString === '') {
          const existing =
            stats === null ? null : await this.files.readFile({ path, threadId })
          let createFault: QualityCoverageDiagnostic | null = null
          let capturedBefore: string | null = existing
          if (capture && existing !== null) {
            const read = await this.files.readTextForEdit({ path, threadId }).catch(() => null)
            if (read === null) {
              createFault = captureUnavailableFault({ path, detail: 'the previous contents could not be read' })
            } else {
              const captured = captureText({ path, text: read.text, strict: read.strict, changed: true })
              if (!captured.ok) createFault = captured.diagnostic
              else capturedBefore = captured.text
            }
          }
          return await createFile({
            path,
            newString,
            existing,
            mode: stats?.mode,
            files: this.files,
            threadId,
            capture,
            captureFault: createFault,
            capturedBefore,
          })
        }

        if (stats === null) return { ok: false, reason: `File does not exist: ${path}` }

        return await replaceInFile({
          path,
          oldString,
          newString,
          replaceAll: replaceAll ?? false,
          mode: stats.mode,
          files: this.files,
          threadId,
          capture,
        })
      },
    })

    return guarded.ok ? guarded.value : { ok: false, reason: guarded.reason }
  }
}

