'use client'

import { useCallback, useMemo } from 'react'
import { skillUsageKeyOf, skillUsageTargetOf, withSkillUsage } from '@dltech/atlas-client/settings'
import { useSkillUsage } from './use-skill-usage'

import type {
  AccessGrantLayer,
  AccessScope,
  LayeredSettingLayer,
  McpServerLayer,
  SkillLayer,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'
import { EQueryState, useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { scopeKeyOf as accessScopeKeyOf } from '@/features/settings/parts/access/access-grant-helpers'
import {
  mcpScopeInputOf,
  type McpResourceScope,
} from '@/features/settings/data/shared/use-mcp-resource'
import { keyOfSkills } from '@/features/settings/data/shared/use-skills'
import type { SkillScopeTarget } from '@/features/settings/data/shared/skills-api'
import { scopeKeyOf, type SettingsScope } from '@/features/settings/scope/settings-scope'

const mcpKeyOf = (scope: McpResourceScope): string =>
  `mcp:${scope.kind}:${scope.kind === 'project' ? scope.projectId : scope.groupId}`

export function useGrantLayers(scope: AccessScope): CloudQuery<AccessGrantLayer[]> {
  const key = accessScopeKeyOf(scope)
  const load = useCallback(
    async () => (await cloudCall(api.accessGrants.layered.query({ scope }))).layers,
    [key],
  )
  return useCloudQuery({ key: `access-grant-layers:${key}`, load })
}

export function useSkillLayers(target: SkillScopeTarget): CloudQuery<SkillLayer[]> {
  const key = keyOfSkills(target)
  const load = useCallback(
    async () => (await cloudCall(api.skills.layered.query(target))).layers,
    [key],
  )
  const query = useCloudQuery({ key: `skill-layers:${key}`, load })
  const targets = (query.data ?? []).flatMap((layer) => {
    const target = skillUsageTargetOf(layer)
    return target === undefined ? [] : [target]
  })
  const usage = useSkillUsage(targets)
  if (query.state !== EQueryState.Ready) return query
  return {
    ...query,
    data: query.data.map((layer) => {
      const target = skillUsageTargetOf(layer)
      return {
        ...layer,
        items: withSkillUsage({
          skills: layer.items,
          usage: target === undefined ? undefined : usage.get(skillUsageKeyOf(target))?.usage,
        }),
      }
    }),
  }
}

export function useMcpLayers(scope: McpResourceScope): CloudQuery<McpServerLayer[]> {
  const kind = scope.kind
  const id = kind === 'project' ? scope.projectId : scope.groupId
  const input = useMemo(() => mcpScopeInputOf(scope), [kind, id])
  const load = useCallback(
    async () => (await cloudCall(api.mcpServers.layered.query(input))).layers,
    [input],
  )
  return useCloudQuery({ key: `mcp-layers:${mcpKeyOf(scope)}`, load })
}

export function useSettingLayers(scope: SettingsScope): CloudQuery<LayeredSettingLayer[]> {
  const key = scopeKeyOf(scope)
  const load = useCallback(async () => {
    const body =
      scope.kind === 'project'
        ? await cloudCall(
            api.projectResources.layeredSettings.query({ projectId: scope.projectId }),
          )
        : await cloudCall(api.groupResources.layeredSettings.query({ groupId: scope.groupId }))
    return body.layers
  }, [key])
  return useCloudQuery({ key: `setting-layers:${key}`, load })
}
