import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import type { ArtifactRow, BuildRow } from './artifact-rows'
import { artifactUrlOf } from './artifact-url'

export const urlOf = (args: { artifact: ArtifactRow; domain: string }): string =>
  artifactUrlOf({ subdomain: args.artifact.subdomain, domain: args.domain })

export async function ownedArtifact(args: { userId: string; slug: string }): Promise<ArtifactRow> {
  const bySlug = await db.orm.public.Artifact.first({ userId: args.userId, slug: args.slug })
  const artifact =
    bySlug ?? (await db.orm.public.Artifact.first({ userId: args.userId, subdomain: args.slug }))
  if (artifact === null) throw new NotFoundException(`no artifact ${args.slug}`)
  return artifact
}

export async function buildRowOf(artifact: ArtifactRow): Promise<BuildRow | null> {
  const shown = await db.orm.public.ArtifactVersion.first({
    artifactId: artifact.id,
    version: artifact.currentVersion,
  })
  if (shown !== null) return shown
  return db.orm.public.ArtifactVersion.where({ artifactId: artifact.id })
    .orderBy((row) => row.version.desc())
    .first()
}

export async function buildRowOfVersion(args: {
  artifactId: string
  version: number
}): Promise<BuildRow | null> {
  return db.orm.public.ArtifactVersion.first({
    artifactId: args.artifactId,
    version: args.version,
  })
}
