import { EProjectSettingsSection } from '@/features/project-settings/project-settings-nav'
import { EPageStatus, type PageStatusInfo } from '@/features/settings/status/page-status-kind'

import type { GroupSection } from './group-settings-nav'

export const GROUP_SECTION_STATUS: Record<GroupSection, PageStatusInfo> = {
  [EProjectSettingsSection.Overview]: {
    status: EPageStatus.Live,
    detail:
      'The name and the projects in the group. Every project inherits the group settings below.',
  },
  [EProjectSettingsSection.Sandbox]: {
    status: EPageStatus.Live,
    detail: 'A project in this group boots with these sizes unless the project sets its own.',
  },
  [EProjectSettingsSection.Access]: {
    status: EPageStatus.Live,
    detail: 'Delivered to every session of every project in this group at its next turn.',
  },
  [EProjectSettingsSection.Skills]: {
    status: EPageStatus.Live,
    detail: 'Saved for this group and written into the sandboxes of its projects.',
  },
  [EProjectSettingsSection.Mcp]: {
    status: EPageStatus.Live,
    detail: 'Servers reach every project in this group; OAuth sign-ins are per user.',
  },
}
