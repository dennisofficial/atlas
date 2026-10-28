import type { Db } from '../client'

export async function seedUser({ db, id }: { db: Db; id: string }) {
  return db.orm.public.User.create({ id, name: id, email: `${id}@test.local` })
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
