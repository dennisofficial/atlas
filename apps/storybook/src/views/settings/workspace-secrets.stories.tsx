import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  VERCEL_CONFIGURED,
  VERCEL_NOT_CONFIGURED,
  WorkspaceSecretsPage,
  type WorkspaceVercelState,
} from './pages/workspace-secrets'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'Views/Settings/Workspace/Secrets & Env Vars',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.WorkspaceSecrets} renderPage={renderSettingsPage} />
  ),
}

export const Empty: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.WorkspaceSecrets}
      renderPage={(page) =>
        page === ESettingsPage.WorkspaceSecrets ? (
          <WorkspaceSecretsPage initial={[]} />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  ),
}

const pageWith = ({
  vercel,
  readOnly,
}: {
  vercel: WorkspaceVercelState
  readOnly?: boolean
}): Story => ({
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.WorkspaceSecrets}
      renderPage={(page) =>
        page === ESettingsPage.WorkspaceSecrets ? (
          <WorkspaceSecretsPage vercel={vercel} readOnly={readOnly ?? false} />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  ),
})

export const VercelNotConfigured: Story = pageWith({ vercel: VERCEL_NOT_CONFIGURED })

export const VercelConfigured: Story = pageWith({ vercel: VERCEL_CONFIGURED })

export const VercelReadOnly: Story = pageWith({ vercel: VERCEL_CONFIGURED, readOnly: true })

export const VercelAvailableSoon: Story = pageWith({ vercel: { soon: true } })
