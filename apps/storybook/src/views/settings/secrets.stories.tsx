import type { Meta, StoryObj } from '@storybook/react-vite'

import { SecretsPage } from './pages/secrets'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'Views/Settings/Personal/Secrets & Env Vars',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.Secrets} renderPage={renderSettingsPage} />
  ),
}

export const Empty: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Secrets}
      renderPage={(page) =>
        page === ESettingsPage.Secrets ? <SecretsPage initial={[]} /> : renderSettingsPage(page)
      }
    />
  ),
}
