import { randomBytes, randomUUID } from 'node:crypto'
import { NotFoundException } from '@nestjs/common'
import { SUBDOMAIN_LENGTH, subdomainOfBytes } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import type { ArtifactRow } from './artifact-rows'

export async function ownedById(args: {
  userId: string
  artifactId: string
}): Promise<ArtifactRow> {
  const artifact = await db.orm.public.Artifact.first({ id: args.artifactId })
  if (artifact === null || artifact.userId !== args.userId) {
    throw new NotFoundException('no such artifact')
  }
  return artifact
}

export async function resolveArtifact(args: {
  userId: string
  subdomain: string | undefined
  name: string | undefined
}): Promise<ArtifactRow> {
  if (args.subdomain !== undefined) {
    const existing = await db.orm.public.Artifact.first({
      userId: args.userId,
      subdomain: args.subdomain,
    })
    if (existing === null) throw new NotFoundException(`no artifact ${args.subdomain}`)
    return existing
  }
  return createArtifact({ userId: args.userId, name: args.name ?? 'artifact' })
}

export async function createArtifact(args: { userId: string; name: string }): Promise<ArtifactRow> {
  return db.orm.public.Artifact.create({
    id: randomUUID(),
    userId: args.userId,
    subdomain: subdomainOfBytes(randomBytes(SUBDOMAIN_LENGTH)),
    name: args.name,
    currentVersion: 0,
  })
}
