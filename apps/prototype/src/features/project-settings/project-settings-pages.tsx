import type { ComponentType } from 'react'

import type { ProjectFixture } from './fixtures/project-settings'
import { EProjectSettingsSection } from './project-settings-nav'
import { McpTweaked } from './tweaks/mcp'
import { OverviewTweaked } from './tweaks/overview'
import { SandboxPage } from './sandbox-page'
import { SecretsTweaked } from './tweaks/secrets'

export type ProjectSectionProps = { project: ProjectFixture }

export const PROJECT_SECTION_PAGES: Record<
  EProjectSettingsSection,
  ComponentType<ProjectSectionProps>
> = {
  [EProjectSettingsSection.Overview]: OverviewTweaked,
  [EProjectSettingsSection.Sandbox]: () => <SandboxPage />,
  [EProjectSettingsSection.Secrets]: SecretsTweaked,
  [EProjectSettingsSection.Mcp]: McpTweaked,
}
