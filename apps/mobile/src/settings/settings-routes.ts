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
}

export type TRouteOfId = (args: { id: string }) => Href

export const SETTINGS_STACK_SCREENS: readonly ISettingsStackScreen[] = [
  { name: 'settings/index', title: 'Settings' },
  { name: 'settings/models-effort', title: 'Models & Effort' },
  { name: 'settings/agent', title: 'Agent' },
  { name: 'settings/quality', title: 'Code Quality' },
  { name: 'settings/experimental', title: 'Experimental' },
  { name: 'settings/appearance', title: 'Appearance' },
  { name: 'project-settings/[projectId]/index', title: 'Project settings' },
  { name: 'project-settings/[projectId]/overview', title: 'Overview' },
  { name: 'group-settings/[groupId]/index', title: 'Group settings' },
]

export const IOS_SETTINGS_ROUTES: Partial<Record<ESettingsPage, Href>> = {
  [ESettingsPage.ModelsEffort]: '/settings/models-effort',
  [ESettingsPage.Agent]: '/settings/agent',
  [ESettingsPage.Quality]: '/settings/quality',
  [ESettingsPage.Experimental]: '/settings/experimental',
  [ESettingsPage.Appearance]: '/settings/appearance',
}

export const IOS_PROJECT_SECTION_ROUTES: Partial<Record<EProjectSettingsSection, TRouteOfId>> = {
  [EProjectSettingsSection.Overview]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/overview`,
}

export const IOS_GROUP_SECTION_ROUTES: Partial<Record<TGroupSection, TRouteOfId>> = {}

export const IOS_PENDING_PAGES: ReadonlySet<ESettingsPage> = new Set([
  ESettingsPage.Account,
  ESettingsPage.Integrations,
  ESettingsPage.Instructions,
  ESettingsPage.Skills,
  ESettingsPage.Memory,
  ESettingsPage.Providers,
  ESettingsPage.Classifier,
  ESettingsPage.Access,
  ESettingsPage.Groups,
  ESettingsPage.Notifications,
  ESettingsPage.Security,
])

export const IOS_PENDING_PROJECT_SECTIONS: ReadonlySet<EProjectSettingsSection> = new Set([
  EProjectSettingsSection.Sandbox,
  EProjectSettingsSection.Access,
  EProjectSettingsSection.Skills,
  EProjectSettingsSection.Mcp,
  EProjectSettingsSection.PullRequests,
])

export const IOS_PENDING_GROUP_SECTIONS: ReadonlySet<TGroupSection> = new Set([
  EProjectSettingsSection.Overview,
  EGroupSettingsSection.Instructions,
  EProjectSettingsSection.Sandbox,
  EProjectSettingsSection.Access,
  EProjectSettingsSection.Skills,
  EProjectSettingsSection.Mcp,
])

export const routedProjectSections = (): typeof PROJECT_SECTIONS =>
  PROJECT_SECTIONS.filter((item) => IOS_PROJECT_SECTION_ROUTES[item.section] !== undefined)

export const routedGroupSections = (): typeof GROUP_SECTIONS =>
  GROUP_SECTIONS.filter((item) => IOS_GROUP_SECTION_ROUTES[item.section] !== undefined)
