import type { ApiClient } from '@dltech/atlas-api-router'
import { newSkillFileOf, type SkillScopeTarget } from '@dltech/atlas-client/settings'
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

export type ISkillLayersResource = {
  layers: SkillLayer[]
  state: EResourceState
  reload: () => void
}

export const useSkills = ({
  api,
  target,
  onMutated,
}: {
  api: ApiClient | undefined
  target: SkillScopeTarget
  onMutated?: () => void
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
      await api.skills.put.mutate(
        await newSkillFileOf({ target: input, name, hashOf: sha256HexOfText }),
      )
      reload()
      if (onMutated !== undefined) onMutated()
    },
    [api, reload, onMutated, scope, projectId, groupId],
  )

  const remove = useCallback(
    async ({ names }: { names: readonly string[] }) => {
      if (api === undefined) throw new Error('Not signed in')
      for (const name of names) {
        await api.skills.removeSkill.mutate({ ...input, skill: name })
      }
      reload()
      if (onMutated !== undefined) onMutated()
    },
    [api, reload, onMutated, scope, projectId, groupId],
  )

  return { skills: resource.data ?? [], state: resource.state, reload, create, remove }
}

export const useSkillLayers = ({
  api,
  target,
}: {
  api: ApiClient | undefined
  target: SkillScopeTarget
}): ISkillLayersResource => {
  const scope = target.scope
  const projectId = target.projectId
  const groupId = target.groupId
  const input = { scope, projectId, groupId }

  const load = useCallback(async (): Promise<SkillLayer[]> => {
    if (api === undefined) return []
    return (await api.skills.layered.query(input)).layers
  }, [api, scope, projectId, groupId])
  const resource = useApiResource<SkillLayer[]>({ load, deps: [api, scope, projectId, groupId] })
  return { layers: resource.data ?? [], state: resource.state, reload: resource.reload }
}
