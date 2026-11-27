import {
  EGroupSettingsSection,
  EProjectSettingsSection,
  ESettingsPage,
  GROUP_SECTIONS,
  PROJECT_SECTIONS,
  type TGroupSection,
} from '@dltech/atlas-client/settings'
import type { Href } from 'expo-router'

export type ISettingsStackScreen = {
  name: string
  title: string
  sheet?: { detents: number[] }
}

export type TRouteOfId = (args: { id: string }) => Href

export const SETTINGS_STACK_SCREENS: readonly ISettingsStackScreen[] = [
  { name: 'settings/index', title: 'Settings' },
  { name: 'settings/integrations', title: 'Integrations & MCP' },
  { name: 'settings/mcp-add', title: 'Add MCP server', sheet: { detents: [0.9, 1] } },
  { name: 'settings/instructions', title: 'Instructions' },
  { name: 'settings/memory', title: 'Memory' },
  { name: 'settings/memory-entry', title: 'Memory', sheet: { detents: [0.75, 1] } },
  { name: 'project-settings/[projectId]/index', title: 'Project settings' },
  { name: 'project-settings/[projectId]/overview', title: 'Overview' },
  { name: 'project-settings/[projectId]/mcp', title: 'MCP' },
  { name: 'group-settings/[groupId]/index', title: 'Group settings' },
  { name: 'group-settings/[groupId]/instructions', title: 'Instructions' },
  { name: 'group-settings/[groupId]/mcp', title: 'MCP' },
]

export const IOS_SETTINGS_ROUTES: Partial<Record<ESettingsPage, Href>> = {
  [ESettingsPage.Integrations]: '/settings/integrations',
  [ESettingsPage.Instructions]: '/settings/instructions',
  [ESettingsPage.Memory]: '/settings/memory',
}

export const IOS_PROJECT_SECTION_ROUTES: Partial<Record<EProjectSettingsSection, TRouteOfId>> = {
  [EProjectSettingsSection.Overview]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/overview`,
  [EProjectSettingsSection.Mcp]: ({ id }) => `/project-settings/${encodeURIComponent(id)}/mcp`,
}

export const IOS_GROUP_SECTION_ROUTES: Partial<Record<TGroupSection, TRouteOfId>> = {
  [EGroupSettingsSection.Instructions]: ({ id }) =>
    `/group-settings/${encodeURIComponent(id)}/instructions`,
  [EProjectSettingsSection.Mcp]: ({ id }) => `/group-settings/${encodeURIComponent(id)}/mcp`,
}

export const IOS_PENDING_PAGES: ReadonlySet<ESettingsPage> = new Set([
  ESettingsPage.Account,
  ESettingsPage.Skills,
  ESettingsPage.ModelsEffort,
  ESettingsPage.Providers,
  ESettingsPage.Classifier,
  ESettingsPage.Access,
  ESettingsPage.Groups,
  ESettingsPage.Appearance,
  ESettingsPage.Notifications,
  ESettingsPage.Security,
  ESettingsPage.Agent,
  ESettingsPage.Experimental,
  ESettingsPage.Quality,
])

export const IOS_PENDING_PROJECT_SECTIONS: ReadonlySet<EProjectSettingsSection> = new Set([
  EProjectSettingsSection.Sandbox,
  EProjectSettingsSection.Access,
  EProjectSettingsSection.Skills,
  EProjectSettingsSection.PullRequests,
])

export const IOS_PENDING_GROUP_SECTIONS: ReadonlySet<TGroupSection> = new Set([
  EProjectSettingsSection.Overview,
  EProjectSettingsSection.Sandbox,
  EProjectSettingsSection.Access,
  EProjectSettingsSection.Skills,
])

export const routedProjectSections = (): typeof PROJECT_SECTIONS =>
  PROJECT_SECTIONS.filter((item) => IOS_PROJECT_SECTION_ROUTES[item.section] !== undefined)

export const routedGroupSections = (): typeof GROUP_SECTIONS =>
  GROUP_SECTIONS.filter((item) => IOS_GROUP_SECTION_ROUTES[item.section] !== undefined)
