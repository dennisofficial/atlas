import { randomUUID } from 'node:crypto'
import type { Tx } from '@dltech/atlas-db'
import { ACCESS_GRANT_NAME_MAX } from '@dltech/atlas-wire'

const suffixedName = (args: { base: string; counter: number }): string => {
  if (args.counter === 1) return args.base
  const suffix = ` ${args.counter}`
  return `${args.base.slice(0, ACCESS_GRANT_NAME_MAX - suffix.length)}${suffix}`
}

const grantNameOf = (args: { taken: readonly string[]; label: string }): string => {
  const taken = new Set(args.taken)
  const base = args.label.trim().slice(0, ACCESS_GRANT_NAME_MAX) || 'grant'
  let counter = 1
  while (taken.has(suffixedName({ base, counter }))) counter += 1
  return suffixedName({ base, counter })
}

export const createPersonalGrant = async (args: {
  tx: Tx
  userId: string
  label: string
}): Promise<string> => {
  const rows = await args.tx.orm.public.UserAccessGrant.where({ userId: args.userId })
    .select('name')
    .all()
  const name = grantNameOf({ taken: rows.map((row) => row.name), label: args.label })
  const row = await args.tx.orm.public.UserAccessGrant.upsert({
    conflictOn: { userId: args.userId, name },
    create: { id: `uag_${randomUUID()}`, userId: args.userId, name, instruction: '' },
    update: { name },
  })
  return row.id
}

export const createProjectGrant = async (args: {
  tx: Tx
  projectId: string
  label: string
}): Promise<string> => {
  const rows = await args.tx.orm.public.ProjectAccessGrant.where({ projectId: args.projectId })
    .select('name')
    .all()
  const name = grantNameOf({ taken: rows.map((row) => row.name), label: args.label })
  const row = await args.tx.orm.public.ProjectAccessGrant.upsert({
    conflictOn: { projectId: args.projectId, name },
    create: { id: `pag_${randomUUID()}`, projectId: args.projectId, name, instruction: '' },
    update: { name },
  })
  return row.id
}

export const createGroupGrant = async (args: {
  tx: Tx
  groupId: string
  label: string
}): Promise<string> => {
  const rows = await args.tx.orm.public.GroupAccessGrant.where({ groupId: args.groupId })
    .select('name')
    .all()
  const name = grantNameOf({ taken: rows.map((row) => row.name), label: args.label })
  const row = await args.tx.orm.public.GroupAccessGrant.upsert({
    conflictOn: { groupId: args.groupId, name },
    create: { id: `gag_${randomUUID()}`, groupId: args.groupId, name, instruction: '' },
    update: { name },
  })
  return row.id
}

export const cleanupPersonalGrant = async (args: {
  tx: Tx
  userId: string
  grantId: string
}): Promise<void> => {
  const [secrets, mounts] = await Promise.all([
    args.tx.orm.public.UserSecret.where({ userId: args.userId, grantId: args.grantId }).all(),
    args.tx.orm.public.UserFileMount.where({ userId: args.userId, grantId: args.grantId }).all(),
  ])
  if (secrets.length + mounts.length > 0) return
  await args.tx.orm.public.UserAccessGrant.where({
    id: args.grantId,
    userId: args.userId,
    instruction: '',
  }).deleteAndCount()
}

export const cleanupProjectGrant = async (args: {
  tx: Tx
  projectId: string
  grantId: string
}): Promise<void> => {
  const [secrets, mounts] = await Promise.all([
    args.tx.orm.public.ProjectSecret.where({
      projectId: args.projectId,
      grantId: args.grantId,
    }).all(),
    args.tx.orm.public.ProjectFileMount.where({
      projectId: args.projectId,
      grantId: args.grantId,
    }).all(),
  ])
  if (secrets.length + mounts.length > 0) return
  await args.tx.orm.public.ProjectAccessGrant.where({
    id: args.grantId,
    projectId: args.projectId,
    instruction: '',
  }).deleteAndCount()
}

export const cleanupGroupGrant = async (args: {
  tx: Tx
  groupId: string
  grantId: string
}): Promise<void> => {
  const [secrets, mounts] = await Promise.all([
    args.tx.orm.public.GroupSecret.where({ groupId: args.groupId, grantId: args.grantId }).all(),
    args.tx.orm.public.GroupFileMount.where({ groupId: args.groupId, grantId: args.grantId }).all(),
  ])
  if (secrets.length + mounts.length > 0) return
  await args.tx.orm.public.GroupAccessGrant.where({
    id: args.grantId,
    groupId: args.groupId,
    instruction: '',
  }).deleteAndCount()
}
