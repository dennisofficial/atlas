import { EProjectSettingsSection } from '@/features/project-settings/project-settings-nav'

import { ESettingsPage } from '../settings-nav'
import { EPageStatus, type PageStatusInfo } from './page-status-kind'

export const WORKSPACE_PAGE_STATUS = {
  [ESettingsPage.WorkspaceGeneral]: {
    status: EPageStatus.Partial,
    detail:
      'Name and slug are live. Region and default model are saved, but no session reads them yet. Logo upload and ownership transfer are not available yet.',
  },
  [ESettingsPage.WorkspaceMembers]: {
    status: EPageStatus.Stored,
    detail: 'Invitations are recorded but no email is sent yet. Last active is not tracked.',
  },
  [ESettingsPage.WorkspaceSecrets]: {
    status: EPageStatus.Stored,
    detail: "Saved to the workspace; sessions don't load workspace values yet.",
  },
  [ESettingsPage.WorkspaceMcp]: {
    status: EPageStatus.Partial,
    detail: "Servers are saved to the workspace; sessions don't load them yet.",
  },
} as const satisfies Partial<Record<ESettingsPage, PageStatusInfo>>

export const PROJECT_SECTION_STATUS: Record<EProjectSettingsSection, PageStatusInfo> = {
  [EProjectSettingsSection.Overview]: {
    status: EPageStatus.Partial,
    detail:
      'Repository, base branch and additional repositories reach sandboxes; name, description and ship behavior are saved only.',
  },
  [EProjectSettingsSection.Sandbox]: {
    status: EPageStatus.Stored,
    detail: "Size and setup script are saved; sandboxes don't apply them yet.",
  },
  [EProjectSettingsSection.Secrets]: {
    status: EPageStatus.Stored,
    detail: 'Saved to the project; sessions do not inject project secrets yet.',
  },
  [EProjectSettingsSection.Mcp]: {
    status: EPageStatus.Partial,
    detail: "Servers are saved to the project; sessions don't load them yet.",
  },
}
