import { BadRequestException } from '@nestjs/common'
import {
  SPEC_FILE_NAME,
  parseSpec,
  sha256Hex,
  sourcePathOf,
  sourcePrefixOf,
  type ArtifactSpec,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'
import type { ArtifactBlobStore } from './artifact-blob-store'
import type { ArtifactSandboxFile } from './artifact-sandbox'
import { pruneTree, sourceKeysOf } from './artifact-tree'

export async function assertUploaded(args: {
  blobs: ArtifactBlobStore
  id: string
  entries: readonly ManifestEntry[]
}): Promise<void> {
  const stored = await args.blobs.list({ prefix: sourcePrefixOf({ id: args.id }) })
  const present = new Set(stored.map((blob) => blob.pathname))
  const missing = args.entries.find(
    (entry) => !present.has(sourcePathOf({ id: args.id, path: entry.path })),
  )
  if (missing !== undefined) {
    throw new BadRequestException(`no uploaded source for ${missing.path}`)
  }
}

export async function pruneSource(args: {
  blobs: ArtifactBlobStore
  id: string
  entries: readonly ManifestEntry[]
}): Promise<string[]> {
  return pruneTree({
    blobs: args.blobs,
    prefix: sourcePrefixOf({ id: args.id }),
    keep: sourceKeysOf({ id: args.id, entries: args.entries }),
  })
}

export async function pushedSpec(args: {
  blobs: ArtifactBlobStore
  id: string
  entries: readonly ManifestEntry[]
}): Promise<ArtifactSpec> {
  const pushed = args.entries.find((entry) => entry.path === SPEC_FILE_NAME)
  if (pushed === undefined) return parseSpec({})
  const content = await args.blobs.read({
    pathname: sourcePathOf({ id: args.id, path: SPEC_FILE_NAME }),
  })
  if (content === null) {
    throw new BadRequestException(`the pushed source has no readable ${SPEC_FILE_NAME}`)
  }
  return parseSpecOrThrow(content)
}

export const specOfFiles = (
  files: readonly ArtifactSandboxFile[],
): { spec: ArtifactSpec } | { failure: string } => {
  const pushed = files.find((file) => file.path === SPEC_FILE_NAME)
  if (pushed === undefined) return { spec: parseSpec({}) }
  try {
    return { spec: parseSpecOrThrow(pushed.content) }
  } catch (error) {
    return { failure: error instanceof Error ? error.message : `${SPEC_FILE_NAME} is invalid` }
  }
}

const parseSpecOrThrow = (content: Buffer): ArtifactSpec => {
  let raw: unknown
  try {
    raw = JSON.parse(content.toString('utf8'))
  } catch {
    throw new BadRequestException(`${SPEC_FILE_NAME} is not valid JSON`)
  }
  try {
    return parseSpec(raw)
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : `${SPEC_FILE_NAME} is invalid`,
    )
  }
}

export const verifiedSourceOf = async (args: {
  blobs: ArtifactBlobStore
  id: string
  entries: readonly ManifestEntry[]
}): Promise<{ files: ArtifactSandboxFile[] } | { changed: true }> => {
  const files: ArtifactSandboxFile[] = []
  for (const entry of args.entries) {
    const content = await args.blobs.read({
      pathname: sourcePathOf({ id: args.id, path: entry.path }),
    })
    if (content === null || sha256Hex(content) !== entry.sha256) return { changed: true }
    files.push({ path: entry.path, content })
  }
  return { files }
}
