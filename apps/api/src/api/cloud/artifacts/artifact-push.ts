import { BadRequestException } from '@nestjs/common'
import {
  SPEC_FILE_NAME,
  parseSpec,
  routeVersionPrefixOf,
  sourceFilePathOf,
  sourceVersionPrefixOf,
  type ArtifactSpec,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'
import type { ArtifactBlobStore } from './artifact-blob-store'
import { uploadsOf } from './artifact-uploads'

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

export async function assertUploaded(args: {
  blobs: ArtifactBlobStore
  id: string
  version: number
  entries: readonly ManifestEntry[]
}): Promise<void> {
  const present = new Set<string>()
  for (const prefix of [
    sourceVersionPrefixOf({ id: args.id, version: args.version }),
    routeVersionPrefixOf({ id: args.id, version: args.version }),
  ]) {
    for (const blob of await args.blobs.list({ prefix })) present.add(blob.pathname)
  }
  const missing = uploadsOf(args).find((grant) => !present.has(grant.pathname))
  if (missing !== undefined) {
    throw new BadRequestException(`no uploaded file for ${missing.tree}/${missing.path}`)
  }
}

export async function pushedSpec(args: {
  blobs: ArtifactBlobStore
  id: string
  version: number
  entries: readonly ManifestEntry[]
}): Promise<ArtifactSpec> {
  const pushed = args.entries.some((entry) => entry.tree === 'src' && entry.path === SPEC_FILE_NAME)
  if (!pushed) return parseSpec({})
  const content = await args.blobs.read({
    pathname: sourceFilePathOf({ id: args.id, version: args.version, path: SPEC_FILE_NAME }),
  })
  if (content === null) {
    throw new BadRequestException(`the pushed source has no readable ${SPEC_FILE_NAME}`)
  }
  return parseSpecOrThrow(content)
}
