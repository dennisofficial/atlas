import { ESettingsPage } from '../settings-nav'
import { EPageStatus, type PageStatusInfo } from './page-status-kind'

const HARNESS_SYNC =
  'model.id, model.effort and agents.subagentModel are harness settings; they reach a session on the next `atlas` sync.'

export const PERSONAL_PAGE_STATUS = {
  [ESettingsPage.Account]: {
    status: EPageStatus.Partial,
    detail: 'Name, email, GitHub login and workspaces are real. Thread count is not reported yet, and account deletion is disabled.',
  },
  [ESettingsPage.Integrations]: {
    status: EPageStatus.Partial,
    detail: 'MCP servers and the GitHub connection are real (connect GitHub from the terminal with `atlas`). Linear and the suggested servers are sample data.',
  },
  [ESettingsPage.Experimental]: { status: EPageStatus.Stored },
  [ESettingsPage.UsageModels]: { status: EPageStatus.Mock },
  [ESettingsPage.UsageSandboxes]: {
    status: EPageStatus.Partial,
    detail: 'Sandboxes come from Atlas Cloud. Repository, size and cost columns are not reported yet.',
  },
  [ESettingsPage.Instructions]: { status: EPageStatus.Live },
  [ESettingsPage.Memory]: { status: EPageStatus.Live },
  [ESettingsPage.ModelsEffort]: { status: EPageStatus.Stored, detail: HARNESS_SYNC },
  [ESettingsPage.Providers]: { status: EPageStatus.Live },
  [ESettingsPage.Secrets]: { status: EPageStatus.Live },
  [ESettingsPage.Skills]: { status: EPageStatus.Mock },
  [ESettingsPage.Plugins]: { status: EPageStatus.Mock },
  [ESettingsPage.Appearance]: {
    status: EPageStatus.Stored,
    detail: 'The theme is applied to this page; density, font size and motion are saved but not applied yet.',
  },
  [ESettingsPage.KeyboardShortcuts]: { status: EPageStatus.Mock },
  [ESettingsPage.Notifications]: { status: EPageStatus.Stored },
  [ESettingsPage.Security]: {
    status: EPageStatus.Partial,
    detail: 'Signed-in sessions are real. Pending device codes and sign-in activity are sample data.',
  },
} as const satisfies Partial<Record<ESettingsPage, PageStatusInfo>>
