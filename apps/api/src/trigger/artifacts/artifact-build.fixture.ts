import { randomUUID } from 'node:crypto'
import {
  manifestHash,
  routePathOf,
  sha256Hex,
  sourcePathOf,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { artifactRouteSchema } from '@dltech/atlas-wire'
import { ArtifactBuild } from '../../api/cloud/artifacts/artifact-build'
import type { ArtifactBuildPayload } from '../../api/cloud/artifacts/artifact-build.contract'
import { FakeArtifactBlobStore } from '../../api/cloud/artifacts/artifact-blob-store.fakes'
import { FakeArtifactSandbox } from '../../api/cloud/artifacts/artifact-sandbox.fakes'
import { recordBuild, EBuildStatus } from '../../api/cloud/artifacts/artifact-versions'

export const USER_ID = 'user-a'

export const SOURCE = { 'index.html': '<h1>hello</h1>', 'app.css': 'h1{color:red}' }

export const entryOf = (path: string, body: string): ManifestEntry => ({
  path,
  tree: 'src',
  sha256: sha256Hex(Buffer.from(body)),
  size: Buffer.byteLength(body),
  type: path.endsWith('.css') ? 'text/css' : 'text/html',
})

export const depsOf = (args: { blobs: FakeArtifactBlobStore; sandbox: FakeArtifactSandbox }) => ({
  blobs: args.blobs,
  build: new ArtifactBuild(args.sandbox),
})

export const keysUnder = (args: { blobs: FakeArtifactBlobStore; prefix: string }): string[] =>
  [...args.blobs.stored.keys()].filter((key) => key.startsWith(args.prefix)).sort()

export const rowOf = (args: { artifactId: string; version: number }) =>
  db.orm.public.ArtifactVersion.first({
    artifactId: args.artifactId,
    version: args.version,
  })

export const routeOf = (args: { blobs: FakeArtifactBlobStore; subdomain: string }) =>
  artifactRouteSchema.parse(args.blobs.bodyOf(routePathOf({ id: args.subdomain })))

export const seedVersion = async (args: {
  blobs: FakeArtifactBlobStore
  subdomain: string
  version: number
  currentVersion: number
  builder?: unknown
  status?: string
  bodies?: Record<string, string>
}): Promise<{ artifactId: string; version: number; payload: ArtifactBuildPayload }> => {
  const artifactId = `artifact-${args.subdomain}`
  const base = args.bodies ?? SOURCE
  const bodies =
    args.builder === undefined ? base : { ...base, 'artifact.json': JSON.stringify(args.builder) }
  const entries = Object.entries(bodies).map(([path, body]) => entryOf(path, body))
  const existing = await db.orm.public.Artifact.first({ id: artifactId })
  if (existing === null) {
    await db.orm.public.Artifact.create({
      id: artifactId,
      userId: USER_ID,
      subdomain: args.subdomain,
      name: 'demo',
      currentVersion: args.currentVersion,
    })
  } else {
    await db.orm.public.Artifact.where({ id: artifactId }).update({
      currentVersion: args.currentVersion,
    })
  }
  await db.orm.public.ArtifactVersion.create({
    id: randomUUID(),
    artifactId,
    version: args.version,
    status: args.status ?? EBuildStatus.Building,
    manifest: entries,
    spec: {},
    sourceHash: manifestHash(entries),
    specHash: 'c'.repeat(64),
    bytes: entries.reduce((total, entry) => total + entry.size, 0),
    fileCount: entries.length,
  })
  for (const [path, body] of Object.entries(bodies)) {
    args.blobs.seed({ pathname: sourcePathOf({ id: args.subdomain, path }), body })
  }
  return {
    artifactId,
    version: args.version,
    payload: { artifactId, version: args.version, userId: USER_ID },
  }
}

export const seedRouteObject = (args: {
  blobs: FakeArtifactBlobStore
  subdomain: string
  version: number
}): void => {
  args.blobs.seed({
    pathname: routePathOf({ id: args.subdomain }),
    body: JSON.stringify({
      artifactId: `artifact-${args.subdomain}`,
      subdomain: args.subdomain,
      name: 'demo',
      version: args.version,
      serve: { spa: true },
    }),
  })
}

export const markReady = async (args: { artifactId: string; version: number }): Promise<void> => {
  const row = await rowOf(args)
  if (row === null) return
  await recordBuild({
    row,
    status: EBuildStatus.Ready,
    failure: null,
    log: null,
    durationMs: null,
  })
}

export type Gate = {
  reached: Promise<void>
  hold: () => Promise<void>
  open: () => void
}

export const gateOf = (): Gate => {
  let open = (): void => {}
  let reach = (): void => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  const reached = new Promise<void>((resolve) => {
    reach = resolve
  })
  return {
    reached,
    hold: async () => {
      reach()
      await opened
    },
    open: () => open(),
  }
}
