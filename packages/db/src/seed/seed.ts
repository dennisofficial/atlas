import type { Db } from '../client'

export const SEED_IDS = { user: 'seed_user_dev', personalProject: 'seed_project_personal' } as const

export async function seed(db: Db): Promise<void> {
  await db.orm.public.User.upsert({
    create: { id: SEED_IDS.user, name: 'Dev User', email: 'dev@atlas.local', emailVerified: true },
    update: { name: 'Dev User' },
    conflictOn: { id: SEED_IDS.user },
  })
  await db.orm.public.Project.upsert({
    create: {
      id: SEED_IDS.personalProject,
      name: 'Personal project',
      ownerUserId: SEED_IDS.user,
      createdById: SEED_IDS.user,
    },
    update: { name: 'Personal project' },
    conflictOn: { id: SEED_IDS.personalProject },
  })
}
