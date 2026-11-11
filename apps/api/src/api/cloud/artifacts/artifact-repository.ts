import { NotFoundException } from '@nestjs/common'
import { blobPathOf, type ManifestEntry } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { ArtifactBlobStore } from './artifact-blob-store'
import type { ArtifactRow, VersionRow } from './artifact-rows'
import { artifactUrlOf } from './artifact-url'

const HEAD_CONCURRENCY = 8

export const urlOf = (args: { artifact: ArtifactRow; domain: string }): string =>
  artifactUrlOf({
    token: args.artifact.token,
    slug: args.artifact.slug,
    domain: args.domain,
  })

export async function ownedArtifact(args: { userId: string; slug: string }): Promise<ArtifactRow> {
  const artifact = await db.orm.public.Artifact.first({
    userId: args.userId,
    slug: args.slug,
  })
  if (artifact === null) throw new NotFoundException(`no artifact ${args.slug}`)
  return artifact
}

export async function currentVersionOf(artifact: ArtifactRow): Promise<VersionRow | null> {
  if (artifact.currentVersion === 0) return null
  return db.orm.public.ArtifactVersion.first({
    artifactId: artifact.id,
    version: artifact.currentVersion,
  })
}

export async function newestVersionOf(artifact: ArtifactRow): Promise<VersionRow | null> {
  return db.orm.public.ArtifactVersion.where({ artifactId: artifact.id })
    .orderBy((version) => version.version.desc())
    .first()
}

export async function presentShas(args: {
  blobs: ArtifactBlobStore
  shas: readonly string[]
}): Promise<Set<string>> {
  const unique = [...new Set(args.shas)]
  const present = new Set<string>()
  for (let start = 0; start < unique.length; start += HEAD_CONCURRENCY) {
    const chunk = unique.slice(start, start + HEAD_CONCURRENCY)
    const found = await Promise.all(
      chunk.map(async (sha) => ({
        sha,
        head: await args.blobs.head({ pathname: blobPathOf(sha) }),
      })),
    )
    for (const item of found) if (item.head !== null) present.add(item.sha)
  }
  return present
}

export async function missingBlobs(args: {
  blobs: ArtifactBlobStore
  entries: readonly ManifestEntry[]
}): Promise<ManifestEntry[]> {
  const present = await presentShas({
    blobs: args.blobs,
    shas: args.entries.map((entry) => entry.sha256),
  })
  return args.entries.filter((entry) => !present.has(entry.sha256))
}
