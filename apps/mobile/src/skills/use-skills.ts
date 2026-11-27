import type { ApiClient } from '@dltech/atlas-api-router'
import {
  EMPTY_SKILL_MD,
  SKILL_ENTRY_PATH,
  toBase64Utf8,
  type SkillScopeTarget,
} from '@dltech/atlas-client/settings'
import type { SkillLayer, SkillSummary } from '@dltech/atlas-wire/web'
import { useCallback } from 'react'

import { type EResourceState } from '../settings/api-resource-state'
import { useApiResource } from '../settings/use-api-resource'
import { sha256HexOfText } from './skill-hash'

export type ISkillsResource = {
  skills: SkillSummary[]
  state: EResourceState
  reload: () => void
  create: (args: { name: string }) => Promise<void>
  remove: (args: { names: readonly string[] }) => Promise<void>
}

export const useSkills = ({
  api,
  target,
}: {
  api: ApiClient | undefined
  target: SkillScopeTarget
}): ISkillsResource => {
  const scope = target.scope
  const projectId = target.projectId
  const groupId = target.groupId
  const input = { scope, projectId, groupId }

  const load = useCallback(async (): Promise<SkillSummary[]> => {
    if (api === undefined) return []
    return (await api.skills.list.query(input)).skills
  }, [api, scope, projectId, groupId])
  const resource = useApiResource<SkillSummary[]>({ load, deps: [api, scope, projectId, groupId] })
  const { reload } = resource

  const create = useCallback(
    async ({ name }: { name: string }) => {
      if (api === undefined) throw new Error('Not signed in')
      await api.skills.put.mutate({
        ...input,
        skill: name,
        path: SKILL_ENTRY_PATH,
        content: toBase64Utf8(EMPTY_SKILL_MD),
        contentHash: await sha256HexOfText(EMPTY_SKILL_MD),
      })
      reload()
    },
    [api, reload, scope, projectId, groupId],
  )

  const remove = useCallback(
    async ({ names }: { names: readonly string[] }) => {
      if (api === undefined) throw new Error('Not signed in')
      for (const name of names) {
        await api.skills.removeSkill.mutate({ ...input, skill: name })
      }
      reload()
    },
    [api, reload, scope, projectId, groupId],
  )

  return { skills: resource.data ?? [], state: resource.state, reload, create, remove }
}

export const useSkillLayers = ({
  api,
  target,
}: {
  api: ApiClient | undefined
  target: SkillScopeTarget
}): { layers: SkillLayer[]; state: EResourceState } => {
  const scope = target.scope
  const projectId = target.projectId
  const groupId = target.groupId
  const input = { scope, projectId, groupId }

  const load = useCallback(async (): Promise<SkillLayer[]> => {
    if (api === undefined) return []
    return (await api.skills.layered.query(input)).layers
  }, [api, scope, projectId, groupId])
  const resource = useApiResource<SkillLayer[]>({ load, deps: [api, scope, projectId, groupId] })
  return { layers: resource.data ?? [], state: resource.state }
}
