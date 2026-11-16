import { routePathOf, type ArtifactSpec } from '@dltech/atlas-artifacts'
import type { ArtifactRoute } from '@dltech/atlas-wire'
import type { ArtifactBlobStore } from './artifact-blob-store'

const versionOfRoute = (raw: unknown): number => {
  if (typeof raw !== 'object' || raw === null || !('version' in raw)) return 0
  const version = raw.version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return 0
  return version
}

export async function liveVersionOf(args: {
  blobs: ArtifactBlobStore
  id: string
}): Promise<number> {
  const content = await args.blobs.read({ pathname: routePathOf({ id: args.id }) })
  if (content === null) return 0
  try {
    return versionOfRoute(JSON.parse(content.toString('utf8')))
  } catch {
    return 0
  }
}

export const serveOf = (spec: ArtifactSpec): ArtifactRoute['serve'] =>
  spec.serve.notFound === undefined
    ? { spa: spec.serve.spa }
    : { spa: spec.serve.spa, notFound: spec.serve.notFound }

export async function writeArtifactRoute(args: {
  blobs: ArtifactBlobStore
  artifact: { id: string; subdomain: string; name: string }
  spec: ArtifactSpec
  version: number
}): Promise<void> {
  const route: ArtifactRoute = {
    artifactId: args.artifact.id,
    subdomain: args.artifact.subdomain,
    name: args.artifact.name,
    version: args.version,
    serve: serveOf(args.spec),
  }
  await args.blobs.put({
    pathname: routePathOf({ id: args.artifact.subdomain }),
    body: JSON.stringify(route),
    contentType: 'application/json',
    allowOverwrite: true,
  })
}
