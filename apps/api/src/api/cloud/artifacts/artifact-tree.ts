import {
  contentTypeOf,
  routeFilePathOf,
  sourcePathOf,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'
import type { ArtifactSandboxFile } from './artifact-sandbox'
import type { ArtifactBlobStore } from './artifact-blob-store'

export const sourceKeysOf = (args: { id: string; entries: readonly ManifestEntry[] }): string[] =>
  args.entries.map((entry) => sourcePathOf({ id: args.id, path: entry.path }))

export async function sourceFilesOf(args: {
  blobs: ArtifactBlobStore
  id: string
  entries: readonly ManifestEntry[]
}): Promise<{ files: ArtifactSandboxFile[] } | { missing: string }> {
  const files: ArtifactSandboxFile[] = []
  for (const entry of args.entries) {
    const content = await args.blobs.read({
      pathname: sourcePathOf({ id: args.id, path: entry.path }),
    })
    if (content === null) return { missing: entry.path }
    files.push({ path: entry.path, content })
  }
  return { files }
}

export async function writeRouteTree(args: {
  blobs: ArtifactBlobStore
  id: string
  files: readonly ArtifactSandboxFile[]
}): Promise<string[]> {
  const keys: string[] = []
  for (const file of args.files) {
    const pathname = routeFilePathOf({ id: args.id, path: file.path })
    await args.blobs.put({
      pathname,
      body: file.content,
      contentType: contentTypeOf(file.path),
      allowOverwrite: true,
    })
    keys.push(pathname)
  }
  return keys
}

export async function pruneTree(args: {
  blobs: ArtifactBlobStore
  prefix: string
  keep: readonly string[]
}): Promise<string[]> {
  const kept = new Set(args.keep)
  const stored = await args.blobs.list({ prefix: args.prefix })
  const doomed = stored
    .map((blob) => blob.pathname)
    .filter((pathname) => pathname.startsWith(args.prefix) && !kept.has(pathname))
  await args.blobs.remove(doomed)
  return doomed
}

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
