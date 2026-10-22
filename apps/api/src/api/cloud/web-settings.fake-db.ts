import { db } from '@dltech/atlas-db'
import { seedOrganization, seedUser } from '@dltech/atlas-db/testing'

export const SESSION_USER_IDS = ['user-a', 'user-b', 'user-c']

export async function seedSessionUsers(): Promise<void> {
  for (const id of SESSION_USER_IDS) await seedUser({ db, id })
}

export async function seedWorkspace(args: {
  id: string
  members: { userId: string; role: string }[]
}): Promise<void> {
  await seedOrganization({ db, id: args.id, memberIds: [] })
  for (const member of args.members) {
    await db.orm.public.Member.create({
      id: `${args.id}_${member.userId}`,
      role: member.role,
      organizationId: args.id,
      userId: member.userId,
    })
  }
}

export async function seedProject(args: { id: string; ownerUserId?: string; organizationId?: string }) {
  return db.orm.public.Project.create({
    id: args.id,
    name: args.id,
    ownerUserId: args.organizationId === undefined ? (args.ownerUserId ?? null) : null,
    organizationId: args.organizationId ?? null,
    createdById: args.ownerUserId ?? null,
  })
}
