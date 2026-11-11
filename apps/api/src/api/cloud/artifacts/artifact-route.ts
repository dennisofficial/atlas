import { routePathOf, type ArtifactSpec } from '@dltech/atlas-artifacts'
import type { ArtifactRoute } from '@dltech/atlas-wire'
import type { ArtifactBlobStore } from './artifact-blob-store'

export const serveOf = (spec: ArtifactSpec): ArtifactRoute['serve'] =>
  spec.serve.notFound === undefined
    ? { spa: spec.serve.spa }
    : { spa: spec.serve.spa, notFound: spec.serve.notFound }

export async function writeArtifactRoute(args: {
  blobs: ArtifactBlobStore
  artifact: { id: string; subdomain: string; name: string }
  spec: ArtifactSpec
}): Promise<void> {
  const route: ArtifactRoute = {
    artifactId: args.artifact.id,
    subdomain: args.artifact.subdomain,
    name: args.artifact.name,
    serve: serveOf(args.spec),
  }
  await args.blobs.put({
    pathname: routePathOf({ id: args.artifact.subdomain }),
    body: JSON.stringify(route),
    contentType: 'application/json',
    allowOverwrite: true,
  })
}
