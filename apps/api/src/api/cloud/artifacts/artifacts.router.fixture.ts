import type { INestApplication } from '@nestjs/common'
import { blobPathOf } from '@dltech/atlas-artifacts'
import { artifactBeginPublishOutputSchema } from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { buildSessionTrpcApp, dataOf, trpcMutation } from '../session-trpc-test-app'
import { ArtifactBlobStore } from './artifact-blob-store'
import type { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import { ArtifactBuild } from './artifact-build'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { ArtifactLibraryService } from './artifact-library.service'
import { ArtifactRetention } from './artifact-retention'
import { ArtifactSandbox } from './artifact-sandbox'
import { FakeArtifactSandbox } from './artifact-sandbox.fakes'
import { ArtifactsRouter } from './artifacts.router'
import { ArtifactsService } from './artifacts.service'

export const ARTIFACT_DOMAIN = 'artifacts.test'

export const OWNER = 'session-a'

export const SANDBOX_TOKENS = { 'sandbox-token-a': { threadId: 'thread-a', userId: 'user-a' } }

export const SRC_INDEX = {
  path: 'index.html',
  tree: 'src' as const,
  sha256: 'a'.repeat(64),
  size: 12,
  type: 'text/html',
}

export const SRC_STYLE = {
  path: 'app.css',
  tree: 'src' as const,
  sha256: 'b'.repeat(64),
  size: 5,
  type: 'text/css',
}

export const DEFAULT_INPUT = { name: 'demo', entries: [SRC_INDEX, SRC_STYLE] }

export const withSlug = (slug: string) => ({ slug, entries: DEFAULT_INPUT.entries })

export const buildArtifactsApp = (args: {
  blobs: FakeArtifactBlobStore
  retention: ArtifactRetention
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
      { provide: ArtifactRetention, useValue: args.retention },
      ArtifactBuild,
      { provide: ArtifactSandbox, useValue: args.sandbox ?? new FakeArtifactSandbox() },
      {
        provide: EnvService,
        useValue: { get: (key: string) => (key === 'ARTIFACT_DOMAIN' ? ARTIFACT_DOMAIN : 0) },
      },
    ],
  })

export const seedUploads = (args: { blobs: FakeArtifactBlobStore; shas: readonly string[] }) => {
  for (const sha of args.shas) args.blobs.seed({ pathname: blobPathOf(sha), body: sha })
}

export async function publishArtifact(args: {
  app: INestApplication
  blobs: FakeArtifactBlobStore
  token?: string
  input?: unknown
}): Promise<{ artifactId: string; token: string; slug: string; version: number }> {
  const token = args.token ?? OWNER
  const begun = await trpcMutation({
    app: args.app,
    path: 'artifacts.beginPublish',
    token,
    input: args.input ?? DEFAULT_INPUT,
  }).expect(200)
  const granted = artifactBeginPublishOutputSchema.parse(dataOf(begun.body))
  seedUploads({ blobs: args.blobs, shas: granted.uploads.map((upload) => upload.sha256) })
  await trpcMutation({
    app: args.app,
    path: 'artifacts.commitPublish',
    token,
    input: { artifactId: granted.artifactId, version: granted.version, spec: {} },
  }).expect(200)
  return granted
}
