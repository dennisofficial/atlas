import { EProjectSettingsSection } from '@/features/project-settings/project-settings-nav'

import { ESettingsPage } from '../settings-nav'
import { EPageStatus, type PageStatusInfo } from './page-status-kind'

export const WORKSPACE_PAGE_STATUS = {
  [ESettingsPage.WorkspaceGeneral]: {
    status: EPageStatus.Partial,
    detail:
      'Name, slug, region and default model are saved. Logo upload and ownership transfer are not available yet.',
  },
  [ESettingsPage.WorkspaceMembers]: {
    status: EPageStatus.Stored,
    detail: 'Invitations are recorded but no email is sent yet. Last active is not tracked.',
  },
  [ESettingsPage.WorkspaceSecrets]: {
    status: EPageStatus.Stored,
    detail: "Saved to the workspace; sessions don't inject workspace secrets yet.",
  },
  [ESettingsPage.WorkspaceMcp]: {
    status: EPageStatus.Partial,
    detail:
      "Servers are saved to the workspace; sessions don't load them yet. Tool counts and the suggested servers are sample data.",
  },
} as const satisfies Partial<Record<ESettingsPage, PageStatusInfo>>

export const PROJECT_SECTION_STATUS: Record<EProjectSettingsSection, PageStatusInfo> = {
  [EProjectSettingsSection.Overview]: {
    status: EPageStatus.Stored,
    detail: "The repository's GitHub default branch isn't stored.",
  },
  [EProjectSettingsSection.Sandbox]: {
    status: EPageStatus.Partial,
    detail: 'Size and setup script are saved. Repository file checks and snapshots are sample data.',
  },
  [EProjectSettingsSection.Secrets]: {
    status: EPageStatus.Stored,
    detail: 'Saved to the project; sessions do not inject project secrets yet.',
  },
  [EProjectSettingsSection.Mcp]: {
    status: EPageStatus.Partial,
    detail:
      'Servers are saved to the project. Connection status is not checked, and suggested servers are sample data.',
  },
}
