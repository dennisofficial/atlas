import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  PERSONAL_VERCEL_CONFIGURED,
  PERSONAL_VERCEL_NOT_CONFIGURED,
  SecretsPage,
  type PersonalVercelState,
} from './pages/secrets'
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

const pageWith = (vercel: PersonalVercelState): Story => ({
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Secrets}
      renderPage={(page) =>
        page === ESettingsPage.Secrets ? <SecretsPage vercel={vercel} /> : renderSettingsPage(page)
      }
    />
  ),
})

export const VercelNotConfigured: Story = pageWith(PERSONAL_VERCEL_NOT_CONFIGURED)

export const VercelConfigured: Story = pageWith(PERSONAL_VERCEL_CONFIGURED)
