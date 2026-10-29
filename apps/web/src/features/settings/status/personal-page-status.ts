import { ESettingsPage } from '../settings-nav'
import { EPageStatus, type PageStatusInfo } from './page-status-kind'

export const PERSONAL_PAGE_STATUS = {
  [ESettingsPage.Account]: {
    status: EPageStatus.Partial,
    detail: 'Name, email and GitHub login are real. Thread count is not reported yet.',
  },
  [ESettingsPage.Integrations]: {
    status: EPageStatus.Partial,
    detail:
      "The GitHub connection is real (connect GitHub from the terminal with `atlas`). MCP servers are saved to your account, but sandboxes don't load them yet.",
  },
  [ESettingsPage.UsageSandboxes]: {
    status: EPageStatus.Partial,
    detail:
      'Sandboxes come from Atlas Cloud. Repository, size and cost columns are not reported yet.',
  },
  [ESettingsPage.Instructions]: {
    status: EPageStatus.Live,
    detail: 'Saved to your account and delivered to every sandbox when it starts.',
  },
  [ESettingsPage.Memory]: { status: EPageStatus.Live },
  [ESettingsPage.ModelsEffort]: {
    status: EPageStatus.Partial,
    detail:
      'model.id, model.effort and agents.subagentModel reach sandboxes. The preset, subagent effort and classifier model and effort are saved only.',
  },
  [ESettingsPage.Providers]: { status: EPageStatus.Live },
  [ESettingsPage.Secrets]: {
    status: EPageStatus.Live,
    detail: 'Delivered to your sandboxes as harness secrets.',
  },
  [ESettingsPage.Appearance]: {
    status: EPageStatus.Stored,
    detail:
      'The theme is applied to this page; density, font size and motion are saved but not applied yet.',
  },
  [ESettingsPage.Notifications]: { status: EPageStatus.Stored },
  [ESettingsPage.Agent]: {
    status: EPageStatus.Live,
    detail: 'Saved to your account and delivered to every sandbox when it starts.',
  },
  [ESettingsPage.Security]: {
    status: EPageStatus.Live,
    detail: 'Signed-in sessions come from your account and can be revoked.',
  },
} as const satisfies Partial<Record<ESettingsPage, PageStatusInfo>>
