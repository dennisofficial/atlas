'use client'

import { createContext, useContext, type ReactNode } from 'react'

import {
  EAccessScope,
  EMcpServerScope,
  ESkillScope,
  type AccessScope,
  type McpServerScope,
  type SkillScopeInput,
} from '@dltech/atlas-wire/web'

export type SettingsScope =
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'group'; readonly groupId: string }

const SettingsScopeContext = createContext<SettingsScope | null>(null)

export function SettingsScopeProvider({
  scope,
  children,
}: {
  scope: SettingsScope
  children: ReactNode
}) {
  return <SettingsScopeContext.Provider value={scope}>{children}</SettingsScopeContext.Provider>
}

export function useSettingsScope(): SettingsScope {
  const value = useContext(SettingsScopeContext)
  if (value === null) throw new Error('useSettingsScope needs a SettingsScopeProvider')
  return value
}

export const scopeKeyOf = (scope: SettingsScope): string =>
  scope.kind === 'project' ? `project:${scope.projectId}` : `group:${scope.groupId}`

export const accessScopeOf = (scope: SettingsScope): AccessScope =>
  scope.kind === 'project'
    ? { kind: EAccessScope.Project, projectId: scope.projectId }
    : { kind: EAccessScope.Group, groupId: scope.groupId }

export const mcpScopeOf = (scope: SettingsScope): McpServerScope =>
  scope.kind === 'project'
    ? { scope: EMcpServerScope.Project, projectId: scope.projectId }
    : { scope: EMcpServerScope.Group, groupId: scope.groupId }

export const skillTargetOf = (scope: SettingsScope): SkillScopeInput =>
  scope.kind === 'project'
    ? { scope: ESkillScope.Project, projectId: scope.projectId }
    : { scope: ESkillScope.Group, groupId: scope.groupId }

export const sectionHrefOf = (args: { scope: SettingsScope; section: string }): string =>
  args.scope.kind === 'project'
    ? `/projects/${encodeURIComponent(args.scope.projectId)}/settings/${args.section}`
    : `/groups/${encodeURIComponent(args.scope.groupId)}/settings/${args.section}`

export const PERSONAL_HREF_OF_SECTION: Readonly<Record<string, string>> = {
  access: '/settings/access',
  skills: '/settings/skills',
  mcp: '/settings/integrations',
}
