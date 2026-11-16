import type { INestApplication } from '@nestjs/common'
import {
  SPEC_FILE_NAME,
  routeFilePathOf,
  sha256Hex,
  sourceFilePathOf,
} from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { artifactBeginPublishOutputSchema, type ArtifactUpload } from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { buildSessionTrpcApp, dataOf, trpcMutation } from '../session-trpc-test-app'
import { ArtifactBlobStore } from './artifact-blob-store'
import type { FakeArtifactBlobStore } from './artifact-blob-store.fakes'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { ArtifactLibraryService } from './artifact-library.service'
import { ArtifactsRouter } from './artifacts.router'
import { ArtifactsService } from './artifacts.service'

export const ARTIFACT_DOMAIN = 'artifacts.test'

export const OWNER = 'session-a'

export const SANDBOX_TOKENS = { 'sandbox-token-a': { threadId: 'thread-a', userId: 'user-a' } }

export const SOURCE_BODIES: Record<string, string> = {
  'index.html': '<h1>hello</h1>',
  'app.css': 'h1{color:red}',
}

export const BUILT_BODIES: Record<string, string> = { 'index.html': '<h1>built</h1>' }

const entryOf = (args: { path: string; body: string; type: string; tree?: 'src' | 'dist' }) => ({
  path: args.path,
  tree: args.tree ?? ('src' as const),
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

export const DIST_INDEX = entryOf({
  path: 'index.html',
  body: BUILT_BODIES['index.html'] as string,
  type: 'text/html',
  tree: 'dist',
})

export const BUILD_SPEC = { build: { cmd: 'bun run build', outDir: 'dist' } }

export const SPEC_ENTRY = entryOf({
  path: SPEC_FILE_NAME,
  body: JSON.stringify({ serve: { spa: false } }),
  type: 'application/json',
})

export const BUILD_SPEC_ENTRY = entryOf({
  path: SPEC_FILE_NAME,
  body: JSON.stringify(BUILD_SPEC),
  type: 'application/json',
})

export const DEFAULT_INPUT = { name: 'demo', entries: [SRC_INDEX, SRC_STYLE] }

export const withSubdomain = (subdomain: string) => ({ subdomain, entries: DEFAULT_INPUT.entries })

export const buildArtifactsApp = (args: {
  blobs: FakeArtifactBlobStore
}): Promise<INestApplication> =>
  buildSessionTrpcApp({
    sandboxTokens: SANDBOX_TOKENS,
    providers: [
      ArtifactsRouter,
      ArtifactsService,
      ArtifactLibraryService,
      ArtifactLifecycleService,
      { provide: ArtifactBlobStore, useValue: args.blobs },
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

export const pathnameOf = (args: {
  id: string
  version: number
  upload: Pick<ArtifactUpload, 'path' | 'tree'>
}): string =>
  args.upload.tree === 'src'
    ? sourceFilePathOf({ id: args.id, version: args.version, path: args.upload.path })
    : routeFilePathOf({ id: args.id, version: args.version, path: args.upload.path })

export type GrantedPublish = {
  artifactId: string
  token: string
  subdomain: string
  version: number
  uploads: readonly ArtifactUpload[]
}

export function seedUploads(args: {
  blobs: FakeArtifactBlobStore
  granted: GrantedPublish
  bodies: Record<string, string>
}): void {
  for (const upload of args.granted.uploads) {
    args.blobs.seed({
      pathname: pathnameOf({
        id: args.granted.subdomain,
        version: args.granted.version,
        upload,
      }),
      body: args.bodies[upload.path] ?? `${upload.path} body`,
    })
  }
}

export const typeOf = (path: string): string =>
  path.endsWith('.json') ? 'application/json' : path.endsWith('.css') ? 'text/css' : 'text/html'

export const entryOfBody = entryOf

export async function beginPublish(args: {
  app: INestApplication
  token?: string
  input?: unknown
}): Promise<GrantedPublish> {
  const res = await trpcMutation({
    app: args.app,
    path: 'artifacts.beginPublish',
    token: args.token ?? OWNER,
    input: args.input ?? DEFAULT_INPUT,
  }).expect(200)
  const granted = artifactBeginPublishOutputSchema.parse(dataOf(res.body))
  return { ...granted, token: granted.subdomain }
}

export async function publishArtifact(args: {
  app: INestApplication
  blobs: FakeArtifactBlobStore
  token?: string
  input?: unknown
  bodies?: Record<string, string>
  buildSpec?: unknown
  bodySpec?: unknown
}): Promise<GrantedPublish> {
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
  const specEntry =
    specBody === null
      ? []
      : [entryOf({ path: SPEC_FILE_NAME, body: specBody, type: 'application/json' })]
  const entries =
    args.bodies !== undefined
      ? fromBodies
      : [...(base.entries ?? DEFAULT_INPUT.entries), ...specEntry]
  const granted = await beginPublish({
    app: args.app,
    token,
    input: { ...base, name: base.name ?? 'demo', entries },
  })
  const subdomain = await subdomainOf(granted.artifactId)
  const seeded = { ...granted, subdomain }
  seedUploads({ blobs: args.blobs, granted: seeded, bodies })
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
  return seeded
}
