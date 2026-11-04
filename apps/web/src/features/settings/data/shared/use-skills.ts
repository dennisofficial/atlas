'use client'

import { useCallback } from 'react'
import type { SkillFileMeta, SkillSummary } from '@dltech/atlas-wire/web'

import { useCloudQuery } from '@/lib/use-cloud-query'

import {
  fileToBase64,
  fromBase64Utf8,
  getSkillFile,
  listSkillFiles,
  listSkills,
  putSkillFile,
  removeSkill,
  removeSkillFile,
  sha256HexOfBase64,
  toBase64Utf8,
  type SkillScopeTarget,
} from './skills-api'

export type { SkillScopeTarget }

export const EMPTY_SKILL_MD = `---\nname: \ndescription: \n---\n\n`

export const keyOfSkills = (target: SkillScopeTarget): string =>
  target.projectId === undefined ? 'skills:personal' : `skills:project:${target.projectId}`

const putBase64 = async (
  target: SkillScopeTarget & { skill: string; path: string; baseRevision?: number },
  content: string,
): Promise<number> =>
  putSkillFile({
    ...target,
    content,
    contentHash: await sha256HexOfBase64(content),
  })

export type SkillsSnapshot = { skills: SkillSummary[]; fetchedAt: number }

export function useSkills(target: SkillScopeTarget) {
  const load = useCallback(
    async (): Promise<SkillsSnapshot> => ({
      skills: await listSkills(target),
      fetchedAt: Date.now(),
    }),
    [target.scope, target.projectId],
  )
  const query = useCloudQuery<SkillsSnapshot>({ key: keyOfSkills(target), load })
  const { reload } = query

  const createSkill = useCallback(
    async (name: string) => {
      await putBase64({ ...target, skill: name, path: 'SKILL.md' }, toBase64Utf8(EMPTY_SKILL_MD))
      reload()
    },
    [reload, target.scope, target.projectId],
  )

  const deleteSkills = useCallback(
    async (names: string[]) => {
      for (const name of names) await removeSkill({ ...target, skill: name })
      reload()
    },
    [reload, target.scope, target.projectId],
  )

  return { query, createSkill, deleteSkills }
}

export function useSkillFiles(target: SkillScopeTarget & { skill: string }) {
  const load = useCallback(
    () => listSkillFiles(target),
    [target.scope, target.projectId, target.skill],
  )
  const query = useCloudQuery<SkillFileMeta[]>({
    key: `${keyOfSkills(target)}:${target.skill}`,
    load,
  })
  const { reload } = query

  const readTextFile = useCallback(
    async (path: string): Promise<{ content: string; revision: number }> => {
      const file = await getSkillFile({ ...target, path })
      return { content: fromBase64Utf8(file.content), revision: file.revision }
    },
    [target.scope, target.projectId, target.skill],
  )

  const deletePath = useCallback(
    async (path: string) => {
      const files = await listSkillFiles(target)
      const doomed = files.filter((file) => file.path === path || file.path.startsWith(`${path}/`))
      for (const file of doomed) {
        await removeSkillFile({ ...target, path: file.path, baseRevision: file.revision })
      }
      reload()
    },
    [reload, target.scope, target.projectId, target.skill],
  )

  const addTextFile = useCallback(
    async (path: string) => {
      await putBase64({ ...target, path }, toBase64Utf8(''))
      reload()
    },
    [reload, target.scope, target.projectId, target.skill],
  )

  const uploadFile = useCallback(
    async (path: string, file: File) => {
      await putBase64({ ...target, path }, await fileToBase64(file))
      reload()
    },
    [reload, target.scope, target.projectId, target.skill],
  )

  const renamePath = useCallback(
    async ({ from, to }: { from: string; to: string }) => {
      const files = await listSkillFiles(target)
      const moving = files.filter((file) => file.path === from || file.path.startsWith(`${from}/`))
      for (const file of moving) {
        const nextPath = to + file.path.slice(from.length)
        const current = await getSkillFile({ ...target, path: file.path })
        await putSkillFile({
          ...target,
          path: nextPath,
          content: current.content,
          contentHash: current.contentHash,
        })
        await removeSkillFile({ ...target, path: file.path, baseRevision: file.revision })
      }
      reload()
    },
    [reload, target.scope, target.projectId, target.skill],
  )

  return { query, readTextFile, deletePath, addTextFile, uploadFile, renamePath }
}
