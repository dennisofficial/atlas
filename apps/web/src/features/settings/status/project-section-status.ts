import { EProjectSettingsSection } from '@/features/project-settings/project-settings-nav'

import { EPageStatus, type PageStatusInfo } from './page-status-kind'

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
