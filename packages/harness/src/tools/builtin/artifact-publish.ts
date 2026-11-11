import { join } from 'node:path'

import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  EToolEffect,
  SchemaTool,
  type DeclaredPathField,
  type ProcessPort,
  type FileSystemPort,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { SPEC_FILE_NAME, sha256Hex } from '@dltech/atlas-artifacts'
import type { ArtifactUpload } from '@dltech/atlas-wire'
import { z } from 'zod'

import type { ArtifactPort } from '../../artifacts/artifact-port'
import { EMPTY_SPEC, publishPlanOf, type PlannedFile } from '../../artifacts/artifact-publish-plan'

import { filePathSchema, pathEnvironmentNote, resolveToolPath } from './file-text'

const UPLOAD_CONCURRENCY = 8

const inputSchema = z.strictObject({
  dir: filePathSchema.optional(),
  slug: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(120).optional(),
})

const description = [
  'Publish a directory as an Atlas artifact and answer with the version and the URL it serves at.',
  'dir defaults to the workspace root; point it at the subdirectory that holds artifact.json to publish that instead.',
  'Only git-tracked files, plus untracked files git does not ignore, ship: .env files other than .env.example never ship, and neither do node_modules, .git or __pycache__.',
  'dist/ is built from the published source on the server, so a local build is not uploaded.',
  pathEnvironmentNote,
].join(' ')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type Hashed = PlannedFile & { bytes: Uint8Array }

async function readNulSeparated(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const text = new TextDecoder().decode(await new Response(stream).arrayBuffer())
  return text.split('\0').filter((path) => path.length > 0)
}

async function listGitPaths(args: { dir: string; processes: ProcessPort }): Promise<string[]> {
  const handle = args.processes.spawn({
    cmd: ['git', '-C', args.dir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    cwd: args.dir,
  })
  const [paths, code, stderr] = await Promise.all([
    readNulSeparated(handle.stdout),
    handle.exited,
    new Response(handle.stderr).text(),
  ])
  if (code !== 0) {
    throw new Error(
      `Publishing needs a git worktree: \`git ls-files\` failed in ${args.dir} with ${code}. ${stderr.trim()}`,
    )
  }
  return paths
}

async function specRawOf(args: {
  dir: string
  paths: readonly string[]
  files: FileSystemPort
}): Promise<unknown> {
  if (!args.paths.includes(SPEC_FILE_NAME)) return EMPTY_SPEC
  const text = await args.files.readFile({ path: join(args.dir, SPEC_FILE_NAME) })
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${SPEC_FILE_NAME} is not valid JSON, so the artifact cannot be published.`)
  }
}

async function hashOf(args: {
  dir: string
  paths: readonly string[]
  files: FileSystemPort
}): Promise<Hashed[]> {
  return await Promise.all(
    args.paths.map(async (path) => {
      const bytes = await args.files.readBytes({ path: join(args.dir, path) })
      return { path, sha256: sha256Hex(bytes), size: bytes.byteLength, bytes }
    }),
  )
}

async function putOne(args: { upload: ArtifactUpload; body: Uint8Array; fetchFn: typeof fetch }) {
  const response = await args.fetchFn(args.upload.url, { method: 'PUT', body: args.body })
  if (!response.ok) {
    throw new Error(`uploading ${args.upload.path} failed with HTTP ${response.status}`)
  }
}

async function putUploads(args: {
  uploads: readonly ArtifactUpload[]
  hashed: readonly Hashed[]
  fetchFn: typeof fetch
}): Promise<void> {
  const bodies = new Map(args.hashed.map((file) => [file.path, file.bytes]))
  const queue = [...args.uploads]
  const worker = async (): Promise<void> => {
    for (;;) {
      const upload = queue.shift()
      if (upload === undefined) return
      const body = bodies.get(upload.path)
      if (body === undefined)
        throw new Error(`the server asked for ${upload.path}, which was not read`)
      await putOne({ upload, body, fetchFn: args.fetchFn })
    }
  }
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker))
}

export class PublishArtifactTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'artifact_publish'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields: readonly DeclaredPathField[] = [
    {
      field: 'dir',
      presence: EPathPresence.Optional,
      form: EPathForm.Absolute,
      content: EContentAccess.Reads,
    },
  ]

  constructor(
    private readonly deps: {
      port: ArtifactPort
      processes: ProcessPort
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
    const dir =
      input.dir === undefined
        ? { ok: true as const, path: projectDirectory }
        : resolveToolPath({ projectDirectory, path: input.dir })
    if (!dir.ok) return { ok: false, reason: dir.reason }

    try {
      const paths = await listGitPaths({ dir: dir.path, processes: this.deps.processes })
      const specRaw = await specRawOf({ dir: dir.path, paths, files: this.deps.files })
      const hashed = await hashOf({ dir: dir.path, paths, files: this.deps.files })
      const plan = publishPlanOf({ specRaw, files: hashed })
      const begun = await this.deps.port.beginPublish({
        entries: plan.entries,
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.name === undefined ? {} : { name: input.name }),
      })
      await putUploads({
        uploads: begun.uploads,
        hashed,
        fetchFn: this.deps.fetchFn ?? fetch,
      })
      const committed = await this.deps.port.commitPublish({
        artifactId: begun.artifactId,
        version: begun.version,
        spec: plan.spec,
      })
      return {
        ok: true,
        output: {
          slug: committed.slug,
          version: committed.version,
          url: committed.url,
          status: committed.status,
        },
        modelText: [
          `Published ${plan.entries.length} files as ${committed.slug} version ${committed.version}; it serves at ${committed.url} with status ${committed.status}.`,
          'The build runs on the server, so fetching the URL before it reports ready answers from the build log rather than the artifact.',
        ].join('\n\n'),
      }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }
}
