import { routePathOf, type ArtifactSpec, type ManifestEntry } from '@dltech/atlas-artifacts'
import type { ArtifactRoute } from '@dltech/atlas-wire'
import { ArtifactBlobStore } from './artifact-blob-store'

const serveOf = (spec: ArtifactSpec): ArtifactRoute['serve'] =>
  spec.serve.notFound === undefined
    ? { spa: spec.serve.spa }
    : { spa: spec.serve.spa, notFound: spec.serve.notFound }

export async function writeArtifactRoute(args: {
  blobs: ArtifactBlobStore
  artifact: { id: string; token: string; slug: string; name: string }
  version: number
  manifest: readonly ManifestEntry[]
  spec: ArtifactSpec
}): Promise<void> {
  const route: ArtifactRoute = {
    artifactId: args.artifact.id,
    slug: args.artifact.slug,
    name: args.artifact.name,
    version: args.version,
    manifest: [...args.manifest],
    serve: serveOf(args.spec),
  }
  await args.blobs.put({
    pathname: routePathOf(args.artifact),
    body: JSON.stringify(route),
    contentType: 'application/json',
    allowOverwrite: true,
  })
}
