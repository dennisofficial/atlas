import { dirname, join, resolve } from 'node:path'

import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  EToolEffect,
  SchemaTool,
  type DeclaredPathField,
  type FileSystemPort,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { ArtifactRefused, type ArtifactPort } from '../../artifacts/artifact-port'

import { filePathSchema, pathEnvironmentNote, resolveToolPath } from './file-text'

const inputSchema = z.strictObject({
  slug: z.string().min(1).max(120),
  dir: filePathSchema,
  force: z.boolean().optional(),
})

const description = [
  'Restore the source of a published artifact into a directory, so you can read, edit and publish it again.',
  'This writes the artifact source files as they were published at its current version; it is that source, not a copy of any built output.',
  'It refuses a directory that already holds files unless force is true, and force overwrites the files it restores.',
  'Dependencies are not restored, so run bun install before the code will run.',
  pathEnvironmentNote,
].join(' ')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const INVALID_PATH = /^(?:\/|.*(?:^|\/)\.\.(?:\/|$)|.*\\)/

async function occupied(args: { dir: string; files: FileSystemPort }): Promise<boolean> {
  try {
    const entries = await args.files.readDirectory({ path: args.dir })
    return entries.length > 0
  } catch {
    return false
  }
}

async function fetchText(url: string, fetchFn: typeof fetch): Promise<string> {
  const response = await fetchFn(url)
  if (!response.ok) throw new Error(`downloading ${url} failed with HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ArtifactRefused(
      `${redactedPath(url)} is not UTF-8 text, and the filesystem restores text files only. Pull the source directory that holds it instead.`,
    )
  }
}

const redactedPath = (url: string): string => {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

export class PullArtifactTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'artifact_pull'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields: readonly DeclaredPathField[] = [
    {
      field: 'dir',
      presence: EPathPresence.Required,
      form: EPathForm.Absolute,
      content: EContentAccess.Overwrites,
    },
  ]

  constructor(
    private readonly deps: {
      port: ArtifactPort
      files: FileSystemPort
      fetchFn?: typeof fetch | undefined
    },
  ) {
    super()
  }

  protected override async run({
    input,
    projectDirectory,
    signal,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    signal.throwIfAborted()
    const dir = resolveToolPath({ projectDirectory, path: input.dir })
    if (!dir.ok) return { ok: false, reason: dir.reason }

    try {
      if (input.force !== true && (await occupied({ dir: dir.path, files: this.deps.files }))) {
        throw new ArtifactRefused(
          `${dir.path} is not empty, so nothing was written. Pull into an empty directory, or pass force: true to overwrite the files inside it.`,
        )
      }

      const exported = await this.deps.port.sourceExport({ slug: input.slug })
      if (exported.entries.length === 0) {
        throw new ArtifactRefused(`${input.slug} has no published source to restore.`)
      }

      const fetchFn = this.deps.fetchFn ?? fetch
      for (const entry of exported.entries) {
        if (INVALID_PATH.test(entry.path)) {
          throw new ArtifactRefused(
            `the export names ${entry.path}, which is not a path inside the directory`,
          )
        }
        const target = resolve(dir.path, entry.path)
        const text = await fetchText(entry.url, fetchFn)
        await this.deps.files.mkdir({ path: dirname(target) })
        await this.deps.files.writeFile({ path: target, content: text })
      }

      return {
        ok: true,
        output: { slug: input.slug, dir: dir.path, files: exported.entries.length },
        modelText: [
          `Restored ${exported.entries.length} source files of ${input.slug} into ${dir.path}.`,
          'This is the editable source, so publishing again from here ships what you change; dependencies are not part of it, so run bun install before the code runs.',
        ].join('\n\n'),
      }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }
}
