import { randomBytes, randomUUID } from 'node:crypto'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { SUBDOMAIN_LENGTH, subdomainOfBytes } from '@dltech/atlas-artifacts'
import { randomToken } from '@dltech/atlas-artifacts/node'
import { db, isUniqueViolation } from '@dltech/atlas-db'
import type { ArtifactRow } from './artifact-rows'

const SLUG_MAX_LENGTH = 39

const ATTEMPTS = 3

const slugFrom = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
  return slug.length === 0 ? 'artifact' : slug
}

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
  slug: string | undefined
  name: string | undefined
}): Promise<ArtifactRow> {
  if (args.slug !== undefined) {
    const existing = await db.orm.public.Artifact.first({
      userId: args.userId,
      slug: args.slug,
    })
    if (existing === null) throw new NotFoundException(`no artifact ${args.slug}`)
    return existing
  }
  return createArtifact({ userId: args.userId, name: args.name ?? 'artifact' })
}

export async function createArtifact(args: { userId: string; name: string }): Promise<ArtifactRow> {
  const base = slugFrom(args.name)
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 30)}-${randomToken(randomBytes(4))}`
    try {
      return await db.orm.public.Artifact.create({
        id: randomUUID(),
        userId: args.userId,
        slug,
        token: randomToken(randomBytes(8)),
        subdomain: subdomainOfBytes(randomBytes(SUBDOMAIN_LENGTH)),
        name: args.name,
        currentVersion: 0,
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }
  }
  throw new ConflictException('could not allocate an artifact slug')
}
