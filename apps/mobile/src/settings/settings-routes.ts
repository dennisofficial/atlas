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
  titleButtons?: number
}

const SKILL_FORM_SHEET = { detents: [0.55, 1] }

export type TRouteOfId = (args: { id: string }) => Href

export const SETTINGS_STACK_SCREENS: readonly ISettingsStackScreen[] = [
  { name: 'settings/index', title: 'Settings' },
  { name: 'settings/integrations', title: 'Integrations & MCP' },
  { name: 'settings/mcp-add', title: 'Add MCP server', sheet: { detents: [0.9, 1] } },
  { name: 'settings/access', title: 'Access', titleButtons: 2 },
  { name: 'settings/access-grant', title: 'Access grant' },
  { name: 'settings/access-form', title: 'Access', sheet: { detents: [0.85, 1] } },
  { name: 'settings/groups', title: 'Groups' },
  { name: 'settings/group-form', title: 'Group', presentation: 'modal' },
  { name: 'settings/group-assign', title: 'Assign projects', presentation: 'modal' },
  { name: 'settings/account', title: 'Account' },
  { name: 'settings/account/edit', title: 'Edit profile' },
  { name: 'settings/security', title: 'Devices & Sessions' },
  { name: 'settings/models-effort', title: 'Models & Effort' },
  { name: 'settings/model-role', title: 'Model' },
  { name: 'settings/providers', title: 'Providers' },
  { name: 'settings/provider-account', title: 'Provider account' },
  { name: 'settings/provider-key', title: 'API key', presentation: 'modal' },
  { name: 'settings/classifier', title: 'Classifier' },
  { name: 'settings/agent', title: 'Agent' },
  { name: 'settings/quality', title: 'Code Quality' },
  { name: 'settings/experimental', title: 'Experimental' },
  { name: 'settings/appearance', title: 'Appearance' },
  { name: 'settings/instructions', title: 'Instructions' },
  { name: 'settings/memory', title: 'Memory', titleButtons: 2 },
  { name: 'settings/memory-entry', title: 'Memory', sheet: { detents: [0.75, 1] } },
  { name: 'settings/skills', title: 'Skills', titleButtons: 2 },
  { name: 'settings/skills-new', title: 'New skill', sheet: SKILL_FORM_SHEET },
  { name: 'settings/skills/[skillId]', title: 'Skill' },
  { name: 'settings/skill-file', title: 'File', sheet: SKILL_FORM_SHEET },
  { name: 'settings/notifications', title: 'Notifications' },
  { name: 'settings/notifications-timezone', title: 'Time zone' },
  { name: 'project-settings/[projectId]/index', title: 'Project settings' },
  { name: 'project-settings/[projectId]/mcp', title: 'MCP' },
  { name: 'project-settings/[projectId]/access', title: 'Access', titleButtons: 2 },
  { name: 'project-settings/[projectId]/overview', title: 'Overview' },
  { name: 'project-settings/[projectId]/repository-picker', title: 'Repository' },
  { name: 'project-settings/[projectId]/skills', title: 'Skills', titleButtons: 2 },
  { name: 'project-settings/[projectId]/skills/[skillId]', title: 'Skill' },
  { name: 'project-settings/[projectId]/skills-new', title: 'New skill', sheet: SKILL_FORM_SHEET },
  { name: 'project-settings/[projectId]/sandbox', title: 'Sandbox' },
  { name: 'project-settings/[projectId]/pull-requests', title: 'Pull requests' },
  { name: 'group-settings/[groupId]/index', title: 'Group settings' },
  { name: 'group-settings/[groupId]/mcp', title: 'MCP' },
  { name: 'group-settings/[groupId]/access', title: 'Access', titleButtons: 2 },
  { name: 'group-settings/[groupId]/overview', title: 'Overview' },
  { name: 'group-settings/[groupId]/sandbox', title: 'Sandbox' },
  { name: 'group-settings/[groupId]/instructions', title: 'Instructions' },
  { name: 'group-settings/[groupId]/skills', title: 'Skills', titleButtons: 2 },
  { name: 'group-settings/[groupId]/skills/[skillId]', title: 'Skill' },
  { name: 'group-settings/[groupId]/skills-new', title: 'New skill', sheet: SKILL_FORM_SHEET },
]

export const IOS_SETTINGS_ROUTES: Partial<Record<ESettingsPage, Href>> = {
  [ESettingsPage.Access]: '/settings/access',
  [ESettingsPage.Groups]: '/settings/groups',
  [ESettingsPage.Integrations]: '/settings/integrations',
  [ESettingsPage.Account]: '/settings/account',
  [ESettingsPage.Security]: '/settings/security',
  [ESettingsPage.ModelsEffort]: '/settings/models-effort',
  [ESettingsPage.Agent]: '/settings/agent',
  [ESettingsPage.Quality]: '/settings/quality',
  [ESettingsPage.Experimental]: '/settings/experimental',
  [ESettingsPage.Appearance]: '/settings/appearance',
  [ESettingsPage.Instructions]: '/settings/instructions',
  [ESettingsPage.Memory]: '/settings/memory',
  [ESettingsPage.Skills]: '/settings/skills',
  [ESettingsPage.Providers]: '/settings/providers',
  [ESettingsPage.Classifier]: '/settings/classifier',
  [ESettingsPage.Notifications]: '/settings/notifications',
}

export const IOS_PROJECT_SECTION_ROUTES: Partial<Record<EProjectSettingsSection, TRouteOfId>> = {
  [EProjectSettingsSection.Access]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/access`,
  [EProjectSettingsSection.Mcp]: ({ id }) => `/project-settings/${encodeURIComponent(id)}/mcp`,
  [EProjectSettingsSection.Overview]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/overview`,
  [EProjectSettingsSection.Skills]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/skills`,
  [EProjectSettingsSection.Sandbox]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/sandbox`,
  [EProjectSettingsSection.PullRequests]: ({ id }) =>
    `/project-settings/${encodeURIComponent(id)}/pull-requests`,
}

export const IOS_GROUP_SECTION_ROUTES: Partial<Record<TGroupSection, TRouteOfId>> = {
  [EProjectSettingsSection.Access]: ({ id }) => `/group-settings/${encodeURIComponent(id)}/access`,
  [EProjectSettingsSection.Mcp]: ({ id }) => `/group-settings/${encodeURIComponent(id)}/mcp`,
  [EProjectSettingsSection.Overview]: ({ id }) =>
    `/group-settings/${encodeURIComponent(id)}/overview`,
  [EGroupSettingsSection.Instructions]: ({ id }) =>
    `/group-settings/${encodeURIComponent(id)}/instructions`,
  [EProjectSettingsSection.Skills]: ({ id }) => `/group-settings/${encodeURIComponent(id)}/skills`,
  [EProjectSettingsSection.Sandbox]: ({ id }) =>
    `/group-settings/${encodeURIComponent(id)}/sandbox`,
}

export const IOS_PENDING_PAGES: ReadonlySet<ESettingsPage> = new Set()

export const IOS_PENDING_PROJECT_SECTIONS: ReadonlySet<EProjectSettingsSection> = new Set()

export const IOS_PENDING_GROUP_SECTIONS: ReadonlySet<TGroupSection> = new Set()

export const routedProjectSections = (): typeof PROJECT_SECTIONS =>
  PROJECT_SECTIONS.filter((item) => IOS_PROJECT_SECTION_ROUTES[item.section] !== undefined)

export const routedGroupSections = (): typeof GROUP_SECTIONS =>
  GROUP_SECTIONS.filter((item) => IOS_GROUP_SECTION_ROUTES[item.section] !== undefined)
