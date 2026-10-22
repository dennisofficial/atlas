import type { Db } from '../client'

export async function seedUser({ db, id }: { db: Db; id: string }) {
  return db.orm.public.User.create({ id, name: id, email: `${id}@test.local` })
}

export async function seedOrganization({ db, id, memberIds }: { db: Db; id: string; memberIds: string[] }) {
  const organization = await db.orm.public.Organization.create({ id, name: id, slug: id })
  for (const userId of memberIds) {
    await db.orm.public.Member.create({ id: `${id}_${userId}`, role: 'owner', organizationId: id, userId })
  }
  return organization
}

export async function seedThread({
  db,
  id,
  userId,
  projectId,
}: {
  db: Db
  id: string
  userId: string
  projectId?: string
}) {
  const at = new Date()
  return db.orm.public.Thread.create({
    id,
    userId,
    createdAt: at,
    updatedAt: at,
    ...(projectId === undefined ? {} : { projectId }),
  })
}
