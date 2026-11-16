import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import type { ArtifactRow, BuildRow } from './artifact-rows'
import { artifactUrlOf } from './artifact-url'
import { EBuildStatus } from './artifact-versions'

export const urlOf = (args: { artifact: ArtifactRow; domain: string }): string =>
  artifactUrlOf({ subdomain: args.artifact.subdomain, domain: args.domain })

export async function ownedArtifact(args: {
  userId: string
  subdomain: string
}): Promise<ArtifactRow> {
  const artifact = await db.orm.public.Artifact.first({
    userId: args.userId,
    subdomain: args.subdomain,
  })
  if (artifact === null) throw new NotFoundException(`no artifact ${args.subdomain}`)
  return artifact
}

const newestRowOf = async (args: {
  artifactId: string
  status?: EBuildStatus
}): Promise<BuildRow | null> =>
  db.orm.public.ArtifactVersion.where({
    artifactId: args.artifactId,
    ...(args.status === undefined ? {} : { status: args.status }),
  })
    .orderBy((row) => row.version.desc())
    .first()

export async function buildRowOf(artifact: ArtifactRow): Promise<BuildRow | null> {
  const ready = await newestRowOf({ artifactId: artifact.id, status: EBuildStatus.Ready })
  if (ready !== null) return ready
  return newestRowOf({ artifactId: artifact.id })
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
