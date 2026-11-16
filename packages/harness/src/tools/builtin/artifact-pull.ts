import { dirname, join, resolve } from 'node:path'

import { linkedSubdomainOf } from '@dltech/atlas-artifacts'
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

import { readSpecFile, writeLink } from '../../artifacts/artifact-link'
import { ArtifactNotFound, ArtifactRefused, type ArtifactPort } from '../../artifacts/artifact-port'
import { artifactFolderNameOf, artifactsRootOf } from '../../artifacts/artifacts-root'
import { atlasDirectory } from '../../store/paths'

import { filePathSchema, pathEnvironmentNote, resolveToolPath } from './file-text'

const inputSchema = z.strictObject({
  subdomain: z.string().min(1).max(120),
  dir: filePathSchema.optional(),
  force: z.boolean().optional(),
})

const description = [
  'Restore the source last pushed to an artifact into its folder under the artifacts folder (/atlas/workspaces/artifacts/<name> in a cloud session), unless dir is given.',
  'It writes the source as it was pushed and never the artifact build output.',
  'Pulling again updates that folder in place, keeping the other files you have there.',
  'The restored artifact.json links the folder to this artifact, so pushing from it keeps the same URL, and its build block says how a push builds the app.',
  'Dependencies are not restored, so install them before the code runs.',
  pathEnvironmentNote,
].join(' ')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const INVALID_PATH = /^(?:\/|.*(?:^|\/)\.\.(?:\/|$)|.*\\)/

type Target = { ok: true; path: string; inPlace: boolean } | { ok: false; reason: string }

async function occupied(args: { dir: string; files: FileSystemPort }): Promise<boolean> {
  try {
    const entries = await args.files.readDirectory({ path: args.dir })
    return entries.length > 0
  } catch {
    return false
  }
}

async function linkedSubdomainIn(args: {
  dir: string
  files: FileSystemPort
}): Promise<string | null> {
  try {
    const file = await readSpecFile({ dir: args.dir, files: args.files })
    return linkedSubdomainOf(file.raw)
  } catch {
    return null
  }
}

async function defaultTarget(args: {
  subdomain: string
  projectDirectory: string
  atlasHome: string
  port: ArtifactPort
  files: FileSystemPort
}): Promise<Target> {
  const artifacts = await args.port.list()
  const artifact = artifacts.find((entry) => entry.subdomain === args.subdomain)
  if (artifact === undefined) {
    throw new ArtifactNotFound(
      `${args.subdomain} is not one of your artifacts, so there is no folder to restore it into. Pass dir to choose one.`,
    )
  }

  const root = artifactsRootOf({
    projectDirectory: args.projectDirectory,
    atlasHome: args.atlasHome,
  })
  const folder = artifactFolderNameOf(artifact.name)
  const candidates = [join(root, folder), join(root, `${folder}-${args.subdomain}`)]

  for (const candidate of candidates) {
    const linked = await linkedSubdomainIn({ dir: candidate, files: args.files })
    if (linked === args.subdomain) return { ok: true, path: candidate, inPlace: true }
    if (linked === null && !(await occupied({ dir: candidate, files: args.files }))) {
      return { ok: true, path: candidate, inPlace: false }
    }
  }

  return {
    ok: false,
    reason: `both ${candidates.join(' and ')} already hold another artifact's work, so nothing was written. Pass dir to say where ${args.subdomain} should go.`,
  }
}

async function explicitTarget(args: {
  dir: string
  subdomain: string
  force: boolean
  projectDirectory: string
  files: FileSystemPort
}): Promise<Target> {
  const resolved = resolveToolPath({ projectDirectory: args.projectDirectory, path: args.dir })
  if (!resolved.ok) return { ok: false, reason: resolved.reason }

  const linked = await linkedSubdomainIn({ dir: resolved.path, files: args.files })
  if (linked === args.subdomain) return { ok: true, path: resolved.path, inPlace: true }

  if (args.force === false && (await occupied({ dir: resolved.path, files: args.files }))) {
    throw new ArtifactRefused(
      `${resolved.path} is not empty, so nothing was written. Pull into an empty directory, or pass force: true to overwrite the files inside it.`,
    )
  }

  return { ok: true, path: resolved.path, inPlace: false }
}

async function fetchBytes(url: string, fetchFn: typeof fetch): Promise<Uint8Array> {
  const response = await fetchFn(url)
  if (!response.ok) throw new Error(`downloading ${url} failed with HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export class PullArtifactTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'artifact_pull'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields: readonly DeclaredPathField[] = [
    {
      field: 'dir',
      presence: EPathPresence.Optional,
      form: EPathForm.Absolute,
      content: EContentAccess.Overwrites,
    },
  ]

  constructor(
    private readonly deps: {
      port: ArtifactPort
      files: FileSystemPort
      fetchFn?: typeof fetch | undefined
      atlasHome?: string | undefined
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

    try {
      const target =
        input.dir === undefined
          ? await defaultTarget({
              subdomain: input.subdomain,
              projectDirectory,
              atlasHome: this.deps.atlasHome ?? atlasDirectory(),
              port: this.deps.port,
              files: this.deps.files,
            })
          : await explicitTarget({
              dir: input.dir,
              subdomain: input.subdomain,
              force: input.force === true,
              projectDirectory,
              files: this.deps.files,
            })
      if (!target.ok) return { ok: false, reason: target.reason }

      const dir = target.path
      await this.deps.files.mkdir({ path: dir })

      const exported = await this.deps.port.sourceExport({ subdomain: input.subdomain })
      if (exported.entries.length === 0) {
        throw new ArtifactRefused(`${input.subdomain} has no published source to restore.`)
      }

      const fetchFn = this.deps.fetchFn ?? fetch
      for (const entry of exported.entries) {
        if (INVALID_PATH.test(entry.path)) {
          throw new ArtifactRefused(
            `the export names ${entry.path}, which is not a path inside the directory`,
          )
        }
        const path = resolve(dir, entry.path)
        const bytes = await fetchBytes(entry.url, fetchFn)
        await this.deps.files.mkdir({ path: dirname(path) })
        await this.deps.files.writeFile({ path, content: bytes })
      }
      const file = await readSpecFile({ dir, files: this.deps.files })
      await writeLink({ file, subdomain: input.subdomain, files: this.deps.files })

      const opening = target.inPlace
        ? `Restored ${exported.entries.length} source files of ${input.subdomain} into ${dir}, writing over the files it already had with the source as last pushed and leaving your other files there alone.`
        : `Restored ${exported.entries.length} source files of ${input.subdomain} into ${dir}, which is its source as last pushed.`

      return {
        ok: true,
        output: { subdomain: input.subdomain, dir, files: exported.entries.length },
        modelText: [
          `${opening} ${file.path} links the folder to ${input.subdomain}.`,
          `To change the app, edit the files there and call artifact_push with dir ${dir}; pushing again keeps the same URL. The build block in artifact.json says how a push builds the app, and Bun and Node are available. This is never the build output, and dependencies are not part of it, so install them before running a build.`,
        ].join('\n\n'),
      }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }
}
