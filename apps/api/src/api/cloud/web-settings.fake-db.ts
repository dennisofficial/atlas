import { db } from '@dltech/atlas-db'
import { seedUser } from '@dltech/atlas-db/testing'

export const SESSION_USER_IDS = ['user-a', 'user-b', 'user-c']

export async function seedSessionUsers(): Promise<void> {
  for (const id of SESSION_USER_IDS) await seedUser({ db, id })
}

export async function seedProject(args: { id: string; ownerUserId: string }) {
  return db.orm.public.Project.create({
    id: args.id,
    name: args.id,
    ownerUserId: args.ownerUserId,
    createdById: args.ownerUserId,
  })
}
