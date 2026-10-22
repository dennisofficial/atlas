import type { Meta, StoryObj } from '@storybook/react-vite'

import { ModelsEffortPage } from './pages/models-effort'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'Views/Settings/Personal/Models & Effort',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.ModelsEffort} renderPage={renderSettingsPage} />
  ),
}

export const Dirty: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.ModelsEffort}
      renderPage={() => <ModelsEffortPage startEdited />}
    />
  ),
}
