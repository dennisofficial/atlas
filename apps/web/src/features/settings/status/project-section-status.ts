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
    status: EPageStatus.Live,
  },
  [EProjectSettingsSection.Files]: {
    status: EPageStatus.Live,
  },
  [EProjectSettingsSection.Mcp]: {
    status: EPageStatus.Live,
    detail:
      'Servers reach every session of this project; OAuth sign-ins are yours and shared across projects.',
  },
}
