'use client'

import type { ComponentType } from 'react'

import { McpPage } from './mcp-page'
import { OverviewPage } from './overview-page'
import { EProjectSettingsSection } from './project-settings-nav'
import { SandboxPage } from './sandbox-page'
import { SecretsPage } from './secrets-page'

export const PROJECT_SECTION_PAGES: Record<EProjectSettingsSection, ComponentType> = {
  [EProjectSettingsSection.Overview]: OverviewPage,
  [EProjectSettingsSection.Sandbox]: SandboxPage,
  [EProjectSettingsSection.Secrets]: SecretsPage,
  [EProjectSettingsSection.Mcp]: McpPage,
}
