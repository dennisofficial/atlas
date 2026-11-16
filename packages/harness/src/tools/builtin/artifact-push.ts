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
import { linkedSubdomainOf, parseSpec, SPEC_FILE_NAME } from '@dltech/atlas-artifacts'
import { z } from 'zod'

import { runLocalBuild, type LocalBuild } from '../../artifacts/artifact-local-build'
import { readSpecFile, writeLink, type SpecFile } from '../../artifacts/artifact-link'
import {
  ArtifactNotFound,
  ArtifactRefused,
  ArtifactSuperseded,
  type ArtifactEntryInput,
  type ArtifactPort,
  type ArtifactPublishBegun,
} from '../../artifacts/artifact-port'
import { countsOf, publishPlanOf } from '../../artifacts/artifact-publish-plan'

import { filePathSchema, pathEnvironmentNote, resolveToolPath } from './file-text'
import {
  collectOutput,
  defaultUploadFetch,
  hashOf,
  listGitPaths,
  putUploads,
  type ArtifactUploadFetch,
} from './artifact-upload'

const LOG_TAIL_CHARS = 4_000

const inputSchema = z.strictObject({
  dir: filePathSchema.optional(),
  subdomain: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(120).optional(),
})

const description = [
  "Push a directory's source to an Atlas artifact and make it live at the artifact's URL at once.",
  'dir defaults to the workspace root; point it at the subdirectory that holds artifact.json to push that instead, and keep each artifact project in its own folder under the artifacts folder (/atlas/workspaces/artifacts/<name> in a cloud session), which artifact_pull uses.',
  'The source is what git tracks plus untracked files git does not ignore: .env files other than .env.example never ship, and neither do node_modules, .git or __pycache__.',
  'When artifact.json declares build ({ install, cmd, outDir, timeoutSec up to 900 }), the push first runs install and then cmd in that directory with the same environment bash gets - Bun and Node are available, so prefer bun install and bun run build - uploads the source and everything in outDir, and the URL serves outDir.',
  'Without a build block the pushed files are served as they are.',
  'A failed build pushes nothing and returns the build log.',
  'Never point it at a build folder: push the project and let the build block produce outDir.',
  'The URL belongs to the directory: its artifact.json carries the artifact subdomain, which the first push writes and every later push, from any session, reuses, so the URL never changes.',
  'subdomain pushes a directory that is not linked yet to an existing artifact; a push never moves a linked directory to another URL and never creates a new one for it.',
  'Another session can artifact_pull the source and push again: the last push wins.',
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

const initNoteOf = (dir: string): string =>
  `Initialised git in ${dir} so the push could list its files.`

const untouchedOf = (linked: string | null): string =>
  linked === null
    ? 'Nothing was pushed, and no artifact was created.'
    : `Nothing was pushed; ${linked} still serves the last version.`

const failureNoteOf = (args: {
  build: Extract<LocalBuild, { ok: false }>
  linked: string | null
}): string =>
  [`${args.build.failure}. ${untouchedOf(args.linked)}`, args.build.log.slice(-LOG_TAIL_CHARS)]
    .filter((part) => part.length > 0)
    .join('\n\n')

const supersededNoteOf = (detail: string): string =>
  `A newer version of that artifact is already live, so this push changed nothing (${detail}). Run artifact_pull to read the live source, reapply your changes on top of it and push again.`

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
      const listing = await listGitPaths({ dir: dir.path, processes: this.deps.processes })
      const paths = listing.paths
      const file = await readSpecFile({ dir: dir.path, files: this.deps.files })
      const linked = linkedSubdomainOf(file.raw)
      const subdomain = targetOf({ file, linked, requested: input.subdomain })
      const spec = parseSpec(file.raw)
      const source = await hashOf({ dir: dir.path, paths, files: this.deps.files })

      const build =
        spec.build === undefined
          ? null
          : await runLocalBuild({
              dir: dir.path,
              build: spec.build,
              processes: this.deps.processes,
              threadId,
              signal,
            })
      if (build !== null && !build.ok) {
        return { ok: false, reason: failureNoteOf({ build, linked }) }
      }

      const output =
        spec.build === undefined
          ? []
          : await collectOutput({
              dir: dir.path,
              outDir: spec.build.outDir,
              files: this.deps.files,
            })
      if (spec.build !== undefined && output.length === 0) {
        return {
          ok: false,
          reason: `build.outDir ${spec.build.outDir} is missing or empty after the build. ${untouchedOf(linked)}`,
        }
      }

      const plan = publishPlanOf({ spec, source, output })
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
        files: [...source, ...output],
        fetchFn: this.deps.fetchFn ?? defaultUploadFetch,
      })
      const committed = await this.deps.port.commitPublish({
        artifactId: begun.artifactId,
        version: begun.version,
        ...(build === null ? {} : { log: build.log, durationMs: build.durationMs }),
      })

      const counts = countsOf(plan)
      return {
        ok: true,
        output: {
          subdomain: committed.subdomain,
          version: committed.version,
          url: committed.url,
          status: committed.status,
        },
        modelText: [
          build === null
            ? `Pushed ${counts.source} files to ${committed.subdomain} as version ${committed.version}; they are served as they are and are live at ${committed.url}.`
            : `Built and pushed ${counts.source} source files and ${counts.output} built files to ${committed.subdomain} as version ${committed.version}; it is live at ${committed.url}.`,
          ...(listing.initialised ? [initNoteOf(dir.path)] : []),
          ...(linked === null ? [linkNoteOf({ file, subdomain: begun.subdomain })] : []),
        ].join('\n\n'),
      }
    } catch (error) {
      if (error instanceof ArtifactSuperseded) {
        return { ok: false, reason: supersededNoteOf(messageOf(error)) }
      }
      return { ok: false, reason: messageOf(error) }
    }
  }
}
