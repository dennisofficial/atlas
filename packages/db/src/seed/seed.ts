import type { Db } from '../client'

export const SEED_IDS = {
  user: 'seed_user_dev',
  organization: 'seed_org_dev',
  member: 'seed_member_dev',
  personalProject: 'seed_project_personal',
  workspaceProject: 'seed_project_workspace',
} as const

export async function seed(db: Db): Promise<void> {
  await db.orm.public.User.upsert({
    create: { id: SEED_IDS.user, name: 'Dev User', email: 'dev@atlas.local', emailVerified: true },
    update: { name: 'Dev User' },
    conflictOn: { id: SEED_IDS.user },
  })
  await db.orm.public.Organization.upsert({
    create: { id: SEED_IDS.organization, name: 'Dev Workspace', slug: 'dev-workspace' },
    update: { name: 'Dev Workspace' },
    conflictOn: { id: SEED_IDS.organization },
  })
  await db.orm.public.Member.upsert({
    create: { id: SEED_IDS.member, role: 'owner', organizationId: SEED_IDS.organization, userId: SEED_IDS.user },
    update: { role: 'owner' },
    conflictOn: { organizationId: SEED_IDS.organization, userId: SEED_IDS.user },
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
  await db.orm.public.Project.upsert({
    create: {
      id: SEED_IDS.workspaceProject,
      name: 'Workspace project',
      organizationId: SEED_IDS.organization,
      createdById: SEED_IDS.user,
    },
    update: { name: 'Workspace project' },
    conflictOn: { id: SEED_IDS.workspaceProject },
  })
}
