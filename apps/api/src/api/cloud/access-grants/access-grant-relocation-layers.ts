import { randomUUID } from 'node:crypto'

import type { Tx } from '@dltech/atlas-db'
import { EAccessMemberKind } from '@dltech/atlas-wire'
import { fileMountPathProblem, personalFileMountPathProblem } from '@dltech/atlas-wire/web'

export type RelocatedMember =
  | { kind: EAccessMemberKind.Secret; name: string; sealed: string }
  | { kind: EAccessMemberKind.File; path: string; sealed: string; mode: number }

export type GrantRow = { id: string; name: string; instruction: string }

export type TakenMembers = { secrets: readonly string[]; files: readonly string[] }

export type AccessGrantTables = {
  pathProblem: (path: string) => string | null
  grantOf: (args: { tx: Tx; id: string }) => Promise<GrantRow | null>
  grantNamed: (args: { tx: Tx; name: string }) => Promise<GrantRow | null>
  membersOf: (args: { tx: Tx; grantId: string }) => Promise<readonly RelocatedMember[]>
  takenMembers: (args: { tx: Tx }) => Promise<TakenMembers>
  createGrant: (args: { tx: Tx; name: string; instruction: string }) => Promise<string>
  addMember: (args: { tx: Tx; grantId: string; member: RelocatedMember }) => Promise<void>
  deleteGrant: (args: { tx: Tx; id: string }) => Promise<void>
}

const rowOf = (row: { id: string; name: string; instruction: string }): GrantRow => ({
  id: row.id,
  name: row.name,
  instruction: row.instruction,
})

export const personalGrantTables = (userId: string): AccessGrantTables => ({
  pathProblem: personalFileMountPathProblem,
  grantOf: async ({ tx, id }) => {
    const row = await tx.orm.public.UserAccessGrant.where({ id, userId }).first()
    return row === null ? null : rowOf(row)
  },
  grantNamed: async ({ tx, name }) => {
    const row = await tx.orm.public.UserAccessGrant.where({ userId, name }).first()
    return row === null ? null : rowOf(row)
  },
  membersOf: async ({ tx, grantId }) => {
    const [secrets, mounts] = await Promise.all([
      tx.orm.public.UserSecret.where({ userId, grantId }).all(),
      tx.orm.public.UserFileMount.where({ userId, grantId }).all(),
    ])
    return [
      ...secrets.map((row) => ({
        kind: EAccessMemberKind.Secret as const,
        name: row.name,
        sealed: row.sealedValue,
      })),
      ...mounts.map((row) => ({
        kind: EAccessMemberKind.File as const,
        path: row.path,
        sealed: row.sealedContents,
        mode: row.mode,
      })),
    ]
  },
  takenMembers: async ({ tx }) => {
    const [secrets, mounts] = await Promise.all([
      tx.orm.public.UserSecret.where({ userId }).select('name').all(),
      tx.orm.public.UserFileMount.where({ userId }).select('path').all(),
    ])
    return {
      secrets: secrets.map((row) => row.name),
      files: mounts.map((row) => row.path),
    }
  },
  createGrant: async ({ tx, name, instruction }) => {
    const id = `uag_${randomUUID()}`
    await tx.orm.public.UserAccessGrant.create({ id, userId, name, instruction })
    return id
  },
  addMember: async ({ tx, grantId, member }) => {
    if (member.kind === EAccessMemberKind.Secret) {
      await tx.orm.public.UserSecret.create({
        id: `sec_${randomUUID()}`,
        userId,
        grantId,
        name: member.name,
        sealedValue: member.sealed,
      })
      return
    }
    await tx.orm.public.UserFileMount.create({
      id: `ufm_${randomUUID()}`,
      userId,
      grantId,
      path: member.path,
      sealedContents: member.sealed,
      mode: member.mode,
    })
  },
  deleteGrant: async ({ tx, id }) => {
    await tx.orm.public.UserAccessGrant.where({ id, userId }).deleteAndCount()
  },
})

export const groupGrantTables = (groupId: string): AccessGrantTables => ({
  pathProblem: fileMountPathProblem,
  grantOf: async ({ tx, id }) => {
    const row = await tx.orm.public.GroupAccessGrant.where({ id, groupId }).first()
    return row === null ? null : rowOf(row)
  },
  grantNamed: async ({ tx, name }) => {
    const row = await tx.orm.public.GroupAccessGrant.where({ groupId, name }).first()
    return row === null ? null : rowOf(row)
  },
  membersOf: async ({ tx, grantId }) => {
    const [secrets, mounts] = await Promise.all([
      tx.orm.public.GroupSecret.where({ groupId, grantId }).all(),
      tx.orm.public.GroupFileMount.where({ groupId, grantId }).all(),
    ])
    return [
      ...secrets.map((row) => ({
        kind: EAccessMemberKind.Secret as const,
        name: row.name,
        sealed: row.sealedValue,
      })),
      ...mounts.map((row) => ({
        kind: EAccessMemberKind.File as const,
        path: row.path,
        sealed: row.sealedContents,
        mode: row.mode,
      })),
    ]
  },
  takenMembers: async ({ tx }) => {
    const [secrets, mounts] = await Promise.all([
      tx.orm.public.GroupSecret.where({ groupId }).select('name').all(),
      tx.orm.public.GroupFileMount.where({ groupId }).select('path').all(),
    ])
    return {
      secrets: secrets.map((row) => row.name),
      files: mounts.map((row) => row.path),
    }
  },
  createGrant: async ({ tx, name, instruction }) => {
    const id = `gag_${randomUUID()}`
    await tx.orm.public.GroupAccessGrant.create({ id, groupId, name, instruction })
    return id
  },
  addMember: async ({ tx, grantId, member }) => {
    if (member.kind === EAccessMemberKind.Secret) {
      await tx.orm.public.GroupSecret.create({
        id: `gsec_${randomUUID()}`,
        groupId,
        grantId,
        name: member.name,
        sealedValue: member.sealed,
      })
      return
    }
    await tx.orm.public.GroupFileMount.create({
      id: `gfm_${randomUUID()}`,
      groupId,
      grantId,
      path: member.path,
      sealedContents: member.sealed,
      mode: member.mode,
    })
  },
  deleteGrant: async ({ tx, id }) => {
    await tx.orm.public.GroupAccessGrant.where({ id, groupId }).deleteAndCount()
  },
})

export const projectGrantTables = (projectId: string): AccessGrantTables => ({
  pathProblem: fileMountPathProblem,
  grantOf: async ({ tx, id }) => {
    const row = await tx.orm.public.ProjectAccessGrant.where({ id, projectId }).first()
    return row === null ? null : rowOf(row)
  },
  grantNamed: async ({ tx, name }) => {
    const row = await tx.orm.public.ProjectAccessGrant.where({ projectId, name }).first()
    return row === null ? null : rowOf(row)
  },
  membersOf: async ({ tx, grantId }) => {
    const [secrets, mounts] = await Promise.all([
      tx.orm.public.ProjectSecret.where({ projectId, grantId }).all(),
      tx.orm.public.ProjectFileMount.where({ projectId, grantId }).all(),
    ])
    return [
      ...secrets.map((row) => ({
        kind: EAccessMemberKind.Secret as const,
        name: row.name,
        sealed: row.sealedValue,
      })),
      ...mounts.map((row) => ({
        kind: EAccessMemberKind.File as const,
        path: row.path,
        sealed: row.sealedContents,
        mode: row.mode,
      })),
    ]
  },
  takenMembers: async ({ tx }) => {
    const [secrets, mounts] = await Promise.all([
      tx.orm.public.ProjectSecret.where({ projectId }).select('name').all(),
      tx.orm.public.ProjectFileMount.where({ projectId }).select('path').all(),
    ])
    return {
      secrets: secrets.map((row) => row.name),
      files: mounts.map((row) => row.path),
    }
  },
  createGrant: async ({ tx, name, instruction }) => {
    const id = `pag_${randomUUID()}`
    await tx.orm.public.ProjectAccessGrant.create({ id, projectId, name, instruction })
    return id
  },
  addMember: async ({ tx, grantId, member }) => {
    if (member.kind === EAccessMemberKind.Secret) {
      await tx.orm.public.ProjectSecret.create({
        id: `psec_${randomUUID()}`,
        projectId,
        grantId,
        name: member.name,
        sealedValue: member.sealed,
      })
      return
    }
    await tx.orm.public.ProjectFileMount.create({
      id: `pfm_${randomUUID()}`,
      projectId,
      grantId,
      path: member.path,
      sealedContents: member.sealed,
      mode: member.mode,
    })
  },
  deleteGrant: async ({ tx, id }) => {
    await tx.orm.public.ProjectAccessGrant.where({ id, projectId }).deleteAndCount()
  },
})
