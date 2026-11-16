import type { ArtifactBlobStore } from './artifact-blob-store'

export async function removeTree(args: {
  blobs: ArtifactBlobStore
  prefix: string
}): Promise<void> {
  const stored = await args.blobs.list({ prefix: args.prefix })
  const doomed = stored
    .map((blob) => blob.pathname)
    .filter((pathname) => pathname.startsWith(args.prefix))
  await args.blobs.remove(doomed)
}

export async function pruneBelow(args: {
  blobs: ArtifactBlobStore
  prefix: string
  version: number
  versionOfKey: (key: string) => number | null
}): Promise<string[]> {
  const stored = await args.blobs.list({ prefix: args.prefix })
  const doomed = stored
    .map((blob) => blob.pathname)
    .filter((pathname) => {
      if (!pathname.startsWith(args.prefix)) return false
      const version = args.versionOfKey(pathname)
      return version === null || version < args.version
    })
  await args.blobs.remove(doomed)
  return doomed
}
