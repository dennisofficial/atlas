import type { INestApplication } from '@nestjs/common'
import { SPEC_FILE_NAME, sha256Hex, sourcePathOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { artifactBeginPublishOutputSchema } from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import {
  JobDispatcher,
  JobDispatchError,
  type AnyTask,
  type JobDispatch,
} from '../../../_core/ports/job-dispatcher'
import { buildSessionTrpcApp, dataOf, trpcMutation } from '../session-trpc-test-app'
import { ArtifactBuild } from './artifact-build'
import {
  ARTIFACT_BUILD_TASK_ID,
  artifactBuildPayloadSchema,
  type ArtifactBuildPayload,
  type ArtifactBuildTaskOutput,
} from './artifact-build.contract'
import { runArtifactBuild } from './artifact-build-run'
import { ArtifactBlobStore } from './artifact-blob-store'
import type { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { ArtifactLibraryService } from './artifact-library.service'
import type { FakeArtifactSandbox } from './artifact-sandbox.fakes'
import { ArtifactsRouter } from './artifacts.router'
import { ArtifactsService } from './artifacts.service'

export const ARTIFACT_DOMAIN = 'artifacts.test'

export const OWNER = 'session-a'

export const SANDBOX_TOKENS = { 'sandbox-token-a': { threadId: 'thread-a', userId: 'user-a' } }

export const SOURCE_BODIES: Record<string, string> = {
  'index.html': '<h1>hello</h1>',
  'app.css': 'h1{color:red}',
}

const entryOf = (args: { path: string; body: string; type: string }) => ({
  path: args.path,
  tree: 'src' as const,
  sha256: sha256Hex(Buffer.from(args.body)),
  size: Buffer.byteLength(args.body),
  type: args.type,
})

export const SRC_INDEX = entryOf({
  path: 'index.html',
  body: SOURCE_BODIES['index.html'] as string,
  type: 'text/html',
})

export const SRC_STYLE = entryOf({
  path: 'app.css',
  body: SOURCE_BODIES['app.css'] as string,
  type: 'text/css',
})

export const DEFAULT_INPUT = { name: 'demo', entries: [SRC_INDEX, SRC_STYLE] }

export const withSubdomain = (subdomain: string) => ({ subdomain, entries: DEFAULT_INPUT.entries })

export type DispatchedBuild = {
  taskId: string
  payload: ArtifactBuildPayload
  idempotencyKey: string
  tags: string[]
}

export class FakeArtifactJobDispatcher extends JobDispatcher {
  readonly calls: DispatchedBuild[] = []
  failWith: string | null = null

  reset(): void {
    this.calls.length = 0
    this.failWith = null
  }

  async dispatch<TTask extends AnyTask>(args: JobDispatch<TTask>): Promise<{ runId: string }> {
    if (args.task.id !== ARTIFACT_BUILD_TASK_ID) throw new Error(`unexpected task ${args.task.id}`)
    if (this.failWith !== null) {
      throw new JobDispatchError({ taskId: args.task.id, cause: new Error(this.failWith) })
    }
    const payload = artifactBuildPayloadSchema.parse(args.task.schema.parse(args.payload))
    this.calls.push({
      taskId: args.task.id,
      payload,
      idempotencyKey: args.idempotencyKey,
      tags: args.tags ?? [],
    })
    return { runId: `artifact-build-${this.calls.length}` }
  }
}

export const buildArtifactsApp = (args: {
  blobs: FakeArtifactBlobStore
  jobs: FakeArtifactJobDispatcher
}): Promise<INestApplication> =>
  buildSessionTrpcApp({
    sandboxTokens: SANDBOX_TOKENS,
    providers: [
      ArtifactsRouter,
      ArtifactsService,
      ArtifactLibraryService,
      ArtifactLifecycleService,
      { provide: ArtifactBlobStore, useValue: args.blobs },
      { provide: JobDispatcher, useValue: args.jobs },
      {
        provide: EnvService,
        useValue: { get: (key: string) => (key === 'ARTIFACT_DOMAIN' ? ARTIFACT_DOMAIN : 0) },
      },
    ],
  })

export const runDispatchedBuilds = async (args: {
  jobs: FakeArtifactJobDispatcher
  blobs: FakeArtifactBlobStore
  sandbox: FakeArtifactSandbox
}): Promise<ArtifactBuildTaskOutput[]> => {
  const outcomes: ArtifactBuildTaskOutput[] = []
  for (const call of args.jobs.calls.splice(0)) {
    outcomes.push(
      await runArtifactBuild({
        payload: call.payload,
        deps: { blobs: args.blobs, build: new ArtifactBuild(args.sandbox) },
      }),
    )
  }
  return outcomes
}

export const subdomainOf = async (artifactId: string): Promise<string> => {
  const artifact = await db.orm.public.Artifact.first({ id: artifactId })
  if (artifact === null) throw new Error(`no artifact ${artifactId}`)
  return artifact.subdomain
}

export async function seedSources(args: {
  blobs: FakeArtifactBlobStore
  artifactId: string
  paths: readonly string[]
  bodies?: Record<string, string>
}): Promise<void> {
  const subdomain = await subdomainOf(args.artifactId)
  const bodies = args.bodies ?? SOURCE_BODIES
  for (const path of args.paths) {
    args.blobs.seed({
      pathname: sourcePathOf({ id: subdomain, path }),
      body: bodies[path] ?? `${path} body`,
    })
  }
}

const typeOf = (path: string): string => (path.endsWith('.json') ? 'application/json' : 'text/html')

export async function publishArtifact(args: {
  app: INestApplication
  blobs: FakeArtifactBlobStore
  sandbox: FakeArtifactSandbox
  jobs: FakeArtifactJobDispatcher
  token?: string
  input?: unknown
  buildSpec?: unknown
  bodies?: Record<string, string>
  bodySpec?: unknown
  drain?: boolean
}): Promise<{
  artifactId: string
  token: string
  subdomain: string
  version: number
}> {
  const token = args.token ?? OWNER
  const base = (args.input ?? DEFAULT_INPUT) as {
    subdomain?: string
    name?: string
    entries?: { path: string }[]
  }
  const specBody = args.buildSpec === undefined ? null : JSON.stringify(args.buildSpec)
  const bodies =
    args.bodies ??
    (specBody === null ? SOURCE_BODIES : { ...SOURCE_BODIES, [SPEC_FILE_NAME]: specBody })
  const fromBodies = Object.entries(bodies).map(([path, body]) =>
    entryOf({ path, body, type: typeOf(path) }),
  )
  const entries =
    args.bodies !== undefined
      ? fromBodies
      : [
          ...(base.entries ?? DEFAULT_INPUT.entries),
          ...(specBody === null
            ? []
            : [entryOf({ path: SPEC_FILE_NAME, body: specBody, type: 'application/json' })]),
        ]
  const begun = await trpcMutation({
    app: args.app,
    path: 'artifacts.beginPublish',
    token,
    input: { ...base, name: base.name ?? 'demo', entries },
  }).expect(200)
  const granted = artifactBeginPublishOutputSchema.parse(dataOf(begun.body))
  await seedSources({
    blobs: args.blobs,
    artifactId: granted.artifactId,
    paths: granted.uploads.map((upload) => upload.path),
    bodies,
  })
  await trpcMutation({
    app: args.app,
    path: 'artifacts.commitPublish',
    token,
    input: {
      artifactId: granted.artifactId,
      version: granted.version,
      ...(args.bodySpec === undefined ? {} : { spec: args.bodySpec }),
    },
  }).expect(200)
  if (args.drain !== false) {
    await runDispatchedBuilds({ jobs: args.jobs, blobs: args.blobs, sandbox: args.sandbox })
  }
  return granted
}
