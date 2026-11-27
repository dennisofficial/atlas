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
  formSheet?: boolean
}

export type TRouteOfId = (args: { id: string }) => Href

export const SETTINGS_STACK_SCREENS: readonly ISettingsStackScreen[] = [
  { name: 'settings/index', title: 'Settings' },
  { name: 'project-settings/[projectId]/index', title: 'Project settings' },
  { name: 'project-settings/[projectId]/overview', title: 'Overview' },
  { name: 'group-settings/[groupId]/index', title: 'Group settings' },
  { name: 'settings/skills', title: 'Skills' },
  { name: 'settings/skills-new', title: 'New skill', formSheet: true },
  { name: 'project-settings/[projectId]/skills', title: 'Skills' },
  { name: 'project-settings/[projectId]/skills-new', title: 'New skill', formSheet: true },
  { name: 'group-settings/[groupId]/skills', title: 'Skills' },
  { name: 'group-settings/[groupId]/skills-new', title: 'New skill', formSheet: true },
]

export const IOS_SETTINGS_ROUTES: Partial<Record<ESettingsPage, Href>> = {
  [ESettingsPage.Skills]: '/settings/skills',
}

export const IOS_PROJECT_SECTION_ROUTES: Partial<Record<EProjectSettingsSection, TRouteOfId>> = {
  [EProjectSettingsSection.Overview]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/overview`,
  [EProjectSettingsSection.Skills]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/skills`,
}

export const IOS_GROUP_SECTION_ROUTES: Partial<Record<TGroupSection, TRouteOfId>> = {
  [EProjectSettingsSection.Skills]: ({ id }) => `/group-settings/${encodeURIComponent(id)}/skills`,
}

export const IOS_PENDING_PAGES: ReadonlySet<ESettingsPage> = new Set([
  ESettingsPage.Account,
  ESettingsPage.Integrations,
  ESettingsPage.Instructions,
  ESettingsPage.Memory,
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
  EProjectSettingsSection.Mcp,
  EProjectSettingsSection.PullRequests,
])

export const IOS_PENDING_GROUP_SECTIONS: ReadonlySet<TGroupSection> = new Set([
  EProjectSettingsSection.Overview,
  EGroupSettingsSection.Instructions,
  EProjectSettingsSection.Sandbox,
  EProjectSettingsSection.Access,
  EProjectSettingsSection.Mcp,
])

export const routedProjectSections = (): typeof PROJECT_SECTIONS =>
  PROJECT_SECTIONS.filter((item) => IOS_PROJECT_SECTION_ROUTES[item.section] !== undefined)

export const routedGroupSections = (): typeof GROUP_SECTIONS =>
  GROUP_SECTIONS.filter((item) => IOS_GROUP_SECTION_ROUTES[item.section] !== undefined)
