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
import { linkedSubdomainOf, SPEC_FILE_NAME, sha256Hex } from '@dltech/atlas-artifacts'
import type { ArtifactUpload } from '@dltech/atlas-wire'
import { z } from 'zod'

import { readSpecFile, writeLink, type SpecFile } from '../../artifacts/artifact-link'
import {
  ArtifactNotFound,
  ArtifactRefused,
  type ArtifactEntryInput,
  type ArtifactPort,
  type ArtifactPublishBegun,
} from '../../artifacts/artifact-port'
import { publishPlanOf, type PlannedFile } from '../../artifacts/artifact-publish-plan'

import { filePathSchema, pathEnvironmentNote, resolveToolPath } from './file-text'

const UPLOAD_CONCURRENCY = 8

const inputSchema = z.strictObject({
  dir: filePathSchema.optional(),
  subdomain: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(120).optional(),
})

const description = [
  'Publish a directory as an Atlas artifact and answer with the version and the URL it serves at.',
  'dir defaults to the workspace root; point it at the subdirectory that holds artifact.json to publish that instead.',
  'The URL belongs to the directory: its artifact.json carries the artifact subdomain, which the first publish writes and every later publish, from any session, reuses.',
  'subdomain publishes a directory that is not linked yet to an existing artifact; a publish never moves a linked directory to another URL and never creates a new one for it.',
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

function targetOf(args: {
  file: SpecFile
  linked: string | null
  requested: string | undefined
}): string | undefined {
  if (args.linked === null || args.requested === undefined || args.requested === args.linked) {
    return args.linked ?? args.requested
  }
  throw new ArtifactRefused(
    `${args.file.path} links this directory to ${args.linked}, so it publishes only there and nothing was published. Moving it to ${args.requested} is a deliberate edit of "subdomain" in ${SPEC_FILE_NAME}, never part of a publish.`,
  )
}

const goneLinkOf = (args: { file: SpecFile; linked: string }): ArtifactRefused =>
  new ArtifactRefused(
    `${args.file.path} links this directory to ${args.linked}, which Atlas Cloud no longer has, so nothing was published. A publish never gives a linked directory a new URL: whether it gets one is the developer's call, and removing "subdomain" from ${SPEC_FILE_NAME} is how the next publish would create it.`,
  )

const linkNoteOf = (args: { file: SpecFile; subdomain: string }): string =>
  `Linked this directory to ${args.subdomain} in ${args.file.path}, so every later publish of it keeps this URL; commit artifact.json with the source so a fresh checkout publishes to the same URL.`

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

const defaultUploadFetch: ArtifactUploadFetch = async (url, init) => {
  const body = new ArrayBuffer(init.body.byteLength)
  new Uint8Array(body).set(init.body)
  return fetch(url, { method: init.method, body })
}

type ArtifactUploadFetch = (
  url: string,
  init: { method: 'PUT'; body: Uint8Array },
) => Promise<{ ok: boolean; status: number }>

async function putOne(args: {
  upload: ArtifactUpload
  body: Uint8Array
  fetchFn: ArtifactUploadFetch
}) {
  const response = await args.fetchFn(args.upload.url, { method: 'PUT', body: args.body })
  if (!response.ok) {
    throw new Error(`uploading ${args.upload.path} failed with HTTP ${response.status}`)
  }
}

async function putUploads(args: {
  uploads: readonly ArtifactUpload[]
  hashed: readonly Hashed[]
  fetchFn: ArtifactUploadFetch
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
      fetchFn?: ArtifactUploadFetch | undefined
    },
  ) {
    super()
  }

  private async begin(args: {
    file: SpecFile
    linked: string | null
    subdomain: string | undefined
    name: string | undefined
    entries: ArtifactEntryInput[]
  }): Promise<ArtifactPublishBegun> {
    try {
      return await this.deps.port.beginPublish({
        entries: args.entries,
        ...(args.subdomain === undefined ? {} : { subdomain: args.subdomain }),
        ...(args.name === undefined ? {} : { name: args.name }),
      })
    } catch (error) {
      if (args.linked !== null && error instanceof ArtifactNotFound) {
        throw goneLinkOf({ file: args.file, linked: args.linked })
      }
      throw error
    }
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
      const file = await readSpecFile({ dir: dir.path, files: this.deps.files })
      const linked = linkedSubdomainOf(file.raw)
      const subdomain = targetOf({ file, linked, requested: input.subdomain })
      const hashed = await hashOf({ dir: dir.path, paths, files: this.deps.files })
      const plan = publishPlanOf({ specRaw: file.raw, files: hashed })
      const begun = await this.begin({
        file,
        linked,
        subdomain,
        name: input.name,
        entries: plan.entries,
      })
      if (linked === null) {
        await writeLink({ file, subdomain: begun.subdomain, files: this.deps.files })
      }
      await putUploads({
        uploads: begun.uploads,
        hashed,
        fetchFn: this.deps.fetchFn ?? defaultUploadFetch,
      })
      const committed = await this.deps.port.commitPublish({
        artifactId: begun.artifactId,
        version: begun.version,
        spec: plan.spec,
      })
      return {
        ok: true,
        output: {
          subdomain: committed.subdomain,
          version: committed.version,
          url: committed.url,
          status: committed.status,
        },
        modelText: [
          `Published ${plan.entries.length} files as ${committed.subdomain} version ${committed.version}; it serves at ${committed.url} with status ${committed.status}.`,
          'The build runs on the server, so fetching the URL before it reports ready answers from the build log rather than the artifact.',
          ...(linked === null ? [linkNoteOf({ file, subdomain: begun.subdomain })] : []),
        ].join('\n\n'),
      }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }
}
