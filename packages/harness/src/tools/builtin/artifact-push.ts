import {
  EContentAccess,
  EPathForm,
  EPathPresence,
  ESubscriptionActor,
  EToolEffect,
  SchemaTool,
  type DeclaredPathField,
  type ProcessPort,
  type FileSystemPort,
  type ThreadId,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { linkedSubdomainOf, SPEC_FILE_NAME } from '@dltech/atlas-artifacts'
import { z } from 'zod'

import { ARTIFACT_BUILD_PROVIDER_KIND } from '../../artifacts/artifact-build-provider'
import { readSpecFile, writeLink, type SpecFile } from '../../artifacts/artifact-link'
import {
  ArtifactNotFound,
  ArtifactRefused,
  type ArtifactEntryInput,
  type ArtifactPort,
  type ArtifactPublishBegun,
} from '../../artifacts/artifact-port'
import { publishPlanOf } from '../../artifacts/artifact-publish-plan'
import type { SubscriptionRegistryPort } from '../../subscriptions/port'

import { filePathSchema, pathEnvironmentNote, resolveToolPath } from './file-text'
import {
  defaultUploadFetch,
  hashOf,
  listGitPaths,
  putUploads,
  type ArtifactUploadFetch,
} from './artifact-upload'

const BUILDING = 'building'
const FAILED = 'failed'

const inputSchema = z.strictObject({
  dir: filePathSchema.optional(),
  subdomain: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(120).optional(),
})

const description = [
  "Push a directory's source to an Atlas artifact, and the server builds it and serves the built site at the artifact's URL.",
  'dir defaults to the workspace root; point it at the subdirectory that holds artifact.json to push that instead.',
  'The source is what git tracks plus untracked files git does not ignore: .env files other than .env.example never ship, and neither do node_modules, .git or __pycache__.',
  "The server builds that source by artifact.json's build block ({ install, cmd, outDir, timeoutSec up to 900 }) and serves outDir; without a build block it serves the pushed files as they are.",
  'Never push a build folder: push the project and declare in the build block how the server builds it.',
  'The URL belongs to the directory: its artifact.json carries the artifact subdomain, which the first push writes and every later push, from any session, reuses, so the URL never changes.',
  'subdomain pushes a directory that is not linked yet to an existing artifact; a push never moves a linked directory to another URL and never creates a new one for it.',
  'The push returns at once and subscribes the conversation to the build, so its result arrives as a notice rather than by polling.',
  pathEnvironmentNote,
].join(' ')

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function targetOf(args: {
  file: SpecFile
  linked: string | null
  requested: string | undefined
}): string | undefined {
  if (args.linked === null || args.requested === undefined || args.requested === args.linked) {
    return args.linked ?? args.requested
  }
  throw new ArtifactRefused(
    `${args.file.path} links this directory to ${args.linked}, so it pushes only there and nothing was pushed. Moving it to ${args.requested} is a deliberate edit of "subdomain" in ${SPEC_FILE_NAME}, never part of a push.`,
  )
}

const goneLinkOf = (args: { file: SpecFile; linked: string }): ArtifactRefused =>
  new ArtifactRefused(
    `${args.file.path} links this directory to ${args.linked}, which Atlas Cloud no longer has, so nothing was pushed. A push never gives a linked directory a new URL: whether it gets one is the developer's call, and removing "subdomain" from ${SPEC_FILE_NAME} is how the next push would create it.`,
  )

const linkNoteOf = (args: { file: SpecFile; subdomain: string }): string =>
  `Linked this directory to ${args.subdomain} in ${args.file.path}, so every later push of it keeps this URL; commit artifact.json with the source so a fresh checkout pushes to the same URL.`

type Subscribed = { id: string } | { error: string } | null

export class PushArtifactTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'artifact_push'
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
      registry?: (() => SubscriptionRegistryPort | null) | undefined
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

  private async subscribe(args: {
    threadId: ThreadId
    projectDirectory: string
    subdomain: string
    version: number
  }): Promise<Subscribed> {
    const registry = this.deps.registry?.() ?? null
    if (registry === null) return null

    const outcome = await registry.subscribe({
      threadId: args.threadId,
      provider: ARTIFACT_BUILD_PROVIDER_KIND,
      input: `${args.subdomain}@${args.version}`,
      projectDirectory: args.projectDirectory,
      by: ESubscriptionActor.Agent,
    })
    if (!outcome.ok) return { error: outcome.error }
    return { id: outcome.subscription.id }
  }

  protected override async run({
    input,
    projectDirectory,
    threadId,
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
      })
      if (committed.status === FAILED) {
        return {
          ok: false,
          reason: `the source of ${committed.subdomain} version ${committed.version} is stored, but the server could not start its build, so ${committed.url} still serves the last good build.`,
        }
      }

      const subscribed =
        committed.status === BUILDING
          ? await this.subscribe({
              threadId,
              projectDirectory,
              subdomain: committed.subdomain,
              version: committed.version,
            })
          : null

      return {
        ok: true,
        output: {
          subdomain: committed.subdomain,
          version: committed.version,
          url: committed.url,
          status: committed.status,
          subscriptionId: subscribed === null || 'error' in subscribed ? null : subscribed.id,
        },
        modelText: [
          `Pushed ${plan.entries.length} source files to ${committed.subdomain} as version ${committed.version}; the build runs on the server.`,
          resultNoteOf({ committed, subscribed }),
          ...(linked === null ? [linkNoteOf({ file, subdomain: begun.subdomain })] : []),
        ].join('\n\n'),
      }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }
}

function resultNoteOf(args: {
  committed: { url: string; status: string }
  subscribed: Subscribed
}): string {
  if (args.subscribed !== null && 'id' in args.subscribed) {
    return `Subscribed to it (id ${args.subscribed.id}): you will be woken with the result — the live URL ${args.committed.url} when it is ready, or the failure and build log. End your turn rather than polling.`
  }
  if (args.subscribed !== null) {
    return `Could not subscribe to the build (${args.subscribed.error}), so call artifact_list later to see whether ${args.committed.url} serves it.`
  }
  return `This session has no subscription registry, so call artifact_list later to see whether ${args.committed.url} serves it.`
}
