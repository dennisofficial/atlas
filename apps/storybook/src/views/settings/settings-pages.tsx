import type { ComponentType, ReactNode } from 'react'

import { AccountPage } from './pages/account'
import { AppearancePage } from './pages/appearance'
import { GithubPage } from './pages/github'
import { InstructionsPage } from './pages/instructions'
import { McpPage } from './pages/mcp'
import { MemoryPage } from './pages/memory'
import { ModelsEffortPage } from './pages/models-effort'
import { ProvidersPage } from './pages/providers'
import { SandboxPage } from './pages/sandbox'
import { SecretsPage } from './pages/secrets'
import { ESettingsPage } from './settings-nav'

const PAGES: Record<ESettingsPage, ComponentType> = {
  [ESettingsPage.Account]: AccountPage,
  [ESettingsPage.Providers]: ProvidersPage,
  [ESettingsPage.Github]: GithubPage,
  [ESettingsPage.Sandbox]: SandboxPage,
  [ESettingsPage.Secrets]: SecretsPage,
  [ESettingsPage.Mcp]: McpPage,
  [ESettingsPage.Instructions]: InstructionsPage,
  [ESettingsPage.Memory]: MemoryPage,
  [ESettingsPage.ModelsEffort]: ModelsEffortPage,
  [ESettingsPage.Appearance]: AppearancePage,
}

export function renderSettingsPage(page: ESettingsPage): ReactNode {
  const Page = PAGES[page]
  return <Page />
}
