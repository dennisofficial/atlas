import type { Meta, StoryObj } from '@storybook/react-vite'

import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'Views/Settings/Personal/Providers',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.Providers} renderPage={renderSettingsPage} />
  ),
}
