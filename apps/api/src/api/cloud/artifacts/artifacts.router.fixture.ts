import type { INestApplication } from '@nestjs/common'
import { sourcePathOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { artifactBeginPublishOutputSchema } from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { buildSessionTrpcApp, dataOf, trpcMutation } from '../session-trpc-test-app'
import { ArtifactBlobStore } from './artifact-blob-store'
import type { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import { ArtifactBuild } from './artifact-build'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { ArtifactLibraryService } from './artifact-library.service'
import { ArtifactSandbox } from './artifact-sandbox'
import { FakeArtifactSandbox } from './artifact-sandbox.fakes'
import { ArtifactsRouter } from './artifacts.router'
import { ArtifactsService } from './artifacts.service'

export const ARTIFACT_DOMAIN = 'artifacts.test'

export const OWNER = 'session-a'

export const SANDBOX_TOKENS = { 'sandbox-token-a': { threadId: 'thread-a', userId: 'user-a' } }

export const SOURCE_BODIES: Record<string, string> = {
  'index.html': '<h1>hello</h1>',
  'app.css': 'h1{color:red}',
}

export const SRC_INDEX = {
  path: 'index.html',
  tree: 'src' as const,
  sha256: 'a'.repeat(64),
  size: 13,
  type: 'text/html',
}

export const SRC_STYLE = {
  path: 'app.css',
  tree: 'src' as const,
  sha256: 'b'.repeat(64),
  size: 13,
  type: 'text/css',
}

export const DEFAULT_INPUT = { name: 'demo', entries: [SRC_INDEX, SRC_STYLE] }

export const withSlug = (slug: string) => ({ slug, entries: DEFAULT_INPUT.entries })

export const buildArtifactsApp = (args: {
  blobs: FakeArtifactBlobStore
  sandbox?: FakeArtifactSandbox
}): Promise<INestApplication> =>
  buildSessionTrpcApp({
    sandboxTokens: SANDBOX_TOKENS,
    providers: [
      ArtifactsRouter,
      ArtifactsService,
      ArtifactLibraryService,
      ArtifactLifecycleService,
      { provide: ArtifactBlobStore, useValue: args.blobs },
      ArtifactBuild,
      { provide: ArtifactSandbox, useValue: args.sandbox ?? new FakeArtifactSandbox() },
      {
        provide: EnvService,
        useValue: { get: (key: string) => (key === 'ARTIFACT_DOMAIN' ? ARTIFACT_DOMAIN : 0) },
      },
    ],
  })

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

export async function publishArtifact(args: {
  app: INestApplication
  blobs: FakeArtifactBlobStore
  token?: string
  input?: unknown
  spec?: unknown
}): Promise<{
  artifactId: string
  token: string
  slug: string
  version: number
  subdomain: string
}> {
  const token = args.token ?? OWNER
  const begun = await trpcMutation({
    app: args.app,
    path: 'artifacts.beginPublish',
    token,
    input: args.input ?? DEFAULT_INPUT,
  }).expect(200)
  const granted = artifactBeginPublishOutputSchema.parse(dataOf(begun.body))
  await seedSources({
    blobs: args.blobs,
    artifactId: granted.artifactId,
    paths: granted.uploads.map((upload) => upload.path),
  })
  await trpcMutation({
    app: args.app,
    path: 'artifacts.commitPublish',
    token,
    input: { artifactId: granted.artifactId, version: granted.version, spec: args.spec ?? {} },
  }).expect(200)
  return { ...granted, subdomain: await subdomainOf(granted.artifactId) }
}
