import { BadRequestException } from '@nestjs/common'
import { MAX_BYTES_PER_USER, type ManifestEntry } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'

const totalBytesOf = (entries: readonly ManifestEntry[]): number =>
  entries.reduce((total, entry) => total + entry.size, 0)

export const storedBytesOf = (entries: readonly ManifestEntry[]): number =>
  entries.some((entry) => entry.tree === 'dist') ? totalBytesOf(entries) : 2 * totalBytesOf(entries)

const storedBytesOfUser = async (userId: string): Promise<number> => {
  const artifacts = await db.orm.public.Artifact.where({ userId }).all()
  if (artifacts.length === 0) return 0
  const rows = await db.orm.public.ArtifactVersion.where((row) =>
    row.artifactId.in(artifacts.map((artifact) => artifact.id)),
  ).all()
  return rows.reduce((total, row) => total + row.bytes, 0)
}

export async function assertPublishQuota(args: {
  userId: string
  entries: readonly ManifestEntry[]
}): Promise<void> {
  const stored = await storedBytesOfUser(args.userId)
  if (stored + storedBytesOf(args.entries) <= MAX_BYTES_PER_USER) return
  throw new BadRequestException(
    `this publish would take you past the ${MAX_BYTES_PER_USER} byte ceiling for artifacts; unpublish one to make room`,
  )
}
