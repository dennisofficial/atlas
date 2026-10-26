import type { ComponentType, ReactNode } from 'react'

import { AppearancePage } from './pages/appearance'
import { GithubPage } from './pages/github'
import { NotificationsPage } from './pages/notifications'
import { SecurityPage } from './pages/security'
import { ESettingsPage } from './settings-nav'
import { AccountTweaked } from './tweaks/account'
import { InstructionsTweaked } from './tweaks/instructions'
import { McpTweaked } from './tweaks/mcp'
import { MemoryTweaked } from './tweaks/memory'
import { ModelsEffortTweaked } from './tweaks/models-effort'
import { ProvidersTweaked } from './tweaks/providers'
import { SandboxTweaked } from './tweaks/sandbox'
import { SecretsTweaked } from './tweaks/secrets'

const PAGES: Record<ESettingsPage, ComponentType> = {
  [ESettingsPage.Account]: AccountTweaked,
  [ESettingsPage.Providers]: ProvidersTweaked,
  [ESettingsPage.Github]: GithubPage,
  [ESettingsPage.Sandbox]: SandboxTweaked,
  [ESettingsPage.Secrets]: SecretsTweaked,
  [ESettingsPage.Mcp]: McpTweaked,
  [ESettingsPage.Instructions]: InstructionsTweaked,
  [ESettingsPage.Memory]: MemoryTweaked,
  [ESettingsPage.ModelsEffort]: ModelsEffortTweaked,
  [ESettingsPage.Appearance]: AppearancePage,
  [ESettingsPage.Notifications]: NotificationsPage,
  [ESettingsPage.Security]: SecurityPage,
}

export function renderSettingsPage(page: ESettingsPage): ReactNode {
  const Page = PAGES[page]
  return <Page />
}
