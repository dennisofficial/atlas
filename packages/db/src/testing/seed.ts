import type { Db } from '../client'

export async function seedUser({ db, id }: { db: Db; id: string }) {
  return db.orm.public.User.create({ id, name: id, email: `${id}@test.local` })
}

export async function seedSession({
  db,
  id,
  userId,
  projectId,
  mainThreadId,
  managedBySessionId,
}: {
  db: Db
  id: string
  userId: string
  projectId?: string
  mainThreadId?: string
  managedBySessionId?: string
}) {
  const at = new Date()
  return db.orm.public.Session.create({
    id,
    userId,
    createdAt: at,
    updatedAt: at,
    ...(projectId === undefined ? {} : { projectId }),
    ...(mainThreadId === undefined ? {} : { mainThreadId }),
    ...(managedBySessionId === undefined ? {} : { managedBySessionId }),
  })
}

export async function seedThread({
  db,
  id,
  userId,
  projectId,
  sessionId,
}: {
  db: Db
  id: string
  userId: string
  projectId?: string
  sessionId?: string
}) {
  const at = new Date()
  const owningSessionId = sessionId ?? `ses_${id}`
  if (sessionId === undefined)
    await seedSession({
      db,
      id: owningSessionId,
      userId,
      ...(projectId === undefined ? {} : { projectId }),
    })
  const thread = await db.orm.public.Thread.create({
    id,
    userId,
    sessionId: owningSessionId,
    createdAt: at,
    updatedAt: at,
  })
  if (sessionId === undefined) {
    await db.orm.public.Session.where({ id: owningSessionId }).update({ mainThreadId: id })
  }
  return thread
}
