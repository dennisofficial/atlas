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
  presentation?: 'modal'
  sheet?: { detents: number[] }
}

export type TRouteOfId = (args: { id: string }) => Href

export const SETTINGS_STACK_SCREENS: readonly ISettingsStackScreen[] = [
  { name: 'settings/index', title: 'Settings' },
  { name: 'settings/groups', title: 'Groups' },
  { name: 'settings/group-form', title: 'Group', presentation: 'modal' },
  { name: 'settings/group-assign', title: 'Assign projects', presentation: 'modal' },
  { name: 'settings/account', title: 'Account' },
  { name: 'settings/account/edit', title: 'Edit profile' },
  { name: 'settings/security', title: 'Devices & Sessions' },
  { name: 'settings/models-effort', title: 'Models & Effort' },
  { name: 'settings/agent', title: 'Agent' },
  { name: 'settings/quality', title: 'Code Quality' },
  { name: 'settings/experimental', title: 'Experimental' },
  { name: 'settings/appearance', title: 'Appearance' },
  { name: 'settings/instructions', title: 'Instructions' },
  { name: 'settings/memory', title: 'Memory' },
  { name: 'settings/memory-entry', title: 'Memory', sheet: { detents: [0.75, 1] } },
  { name: 'project-settings/[projectId]/index', title: 'Project settings' },
  { name: 'project-settings/[projectId]/overview', title: 'Overview' },
  { name: 'project-settings/[projectId]/sandbox', title: 'Sandbox' },
  { name: 'project-settings/[projectId]/pull-requests', title: 'Pull requests' },
  { name: 'group-settings/[groupId]/index', title: 'Group settings' },
  { name: 'group-settings/[groupId]/overview', title: 'Overview' },
  { name: 'group-settings/[groupId]/sandbox', title: 'Sandbox' },
  { name: 'group-settings/[groupId]/instructions', title: 'Instructions' },
]

export const IOS_SETTINGS_ROUTES: Partial<Record<ESettingsPage, Href>> = {
  [ESettingsPage.Groups]: '/settings/groups',
  [ESettingsPage.Account]: '/settings/account',
  [ESettingsPage.Security]: '/settings/security',
  [ESettingsPage.ModelsEffort]: '/settings/models-effort',
  [ESettingsPage.Agent]: '/settings/agent',
  [ESettingsPage.Quality]: '/settings/quality',
  [ESettingsPage.Experimental]: '/settings/experimental',
  [ESettingsPage.Appearance]: '/settings/appearance',
  [ESettingsPage.Instructions]: '/settings/instructions',
  [ESettingsPage.Memory]: '/settings/memory',
}

export const IOS_PROJECT_SECTION_ROUTES: Partial<Record<EProjectSettingsSection, TRouteOfId>> = {
  [EProjectSettingsSection.Overview]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/overview`,
  [EProjectSettingsSection.Sandbox]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/sandbox`,
  [EProjectSettingsSection.PullRequests]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/pull-requests`,
}

export const IOS_GROUP_SECTION_ROUTES: Partial<Record<TGroupSection, TRouteOfId>> = {
  [EProjectSettingsSection.Overview]: ({ id }) =>
    `/group-settings/${encodeURIComponent(id)}/overview`,
  [EGroupSettingsSection.Instructions]: ({ id }) =>
    `/group-settings/${encodeURIComponent(id)}/instructions`,
  [EProjectSettingsSection.Sandbox]: ({ id }) =>
    `/group-settings/${encodeURIComponent(id)}/sandbox`,
}

export const IOS_PENDING_PAGES: ReadonlySet<ESettingsPage> = new Set([
  ESettingsPage.Integrations,
  ESettingsPage.Skills,
  ESettingsPage.Providers,
  ESettingsPage.Classifier,
  ESettingsPage.Access,
  ESettingsPage.Notifications,
])

export const IOS_PENDING_PROJECT_SECTIONS: ReadonlySet<EProjectSettingsSection> = new Set([
  EProjectSettingsSection.Access,
  EProjectSettingsSection.Skills,
  EProjectSettingsSection.Mcp,
])

export const IOS_PENDING_GROUP_SECTIONS: ReadonlySet<TGroupSection> = new Set([
  EProjectSettingsSection.Access,
  EProjectSettingsSection.Skills,
  EProjectSettingsSection.Mcp,
])

export const routedProjectSections = (): typeof PROJECT_SECTIONS =>
  PROJECT_SECTIONS.filter((item) => IOS_PROJECT_SECTION_ROUTES[item.section] !== undefined)

export const routedGroupSections = (): typeof GROUP_SECTIONS =>
  GROUP_SECTIONS.filter((item) => IOS_GROUP_SECTION_ROUTES[item.section] !== undefined)
