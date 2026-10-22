import type { Meta, StoryObj } from '@storybook/react-vite'

import { EProjectSettingsPage, EShipBehavior, PROJECT } from '../../fixtures/project-settings'
import { OverviewPage } from './overview-page'
import { ProjectSettingsShell } from './project-settings-shell'

const meta = {
  title: 'Views/Project Settings/Overview',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Overview}>
      <OverviewPage />
    </ProjectSettingsShell>
  ),
}

export const LegacyMergeBehavior: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Overview}>
      <OverviewPage initial={{ ...PROJECT, shipBehavior: EShipBehavior.Merge }} />
    </ProjectSettingsShell>
  ),
}

export const PersonalProject: Story = {
  render: () => (
    <ProjectSettingsShell active={EProjectSettingsPage.Overview}>
      <OverviewPage initial={{ ...PROJECT, workspace: 'personal' }} />
    </ProjectSettingsShell>
  ),
}
