import type { Meta, StoryObj } from '@storybook/react-vite'

import { BULK_ADD_SAMPLE } from '../../fixtures/settings-library'
import { ESecretsDialog } from '../shared/secrets/secrets-view'
import { SecretsPage } from './pages/secrets'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'Views/Settings/Secrets & Env Vars',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function renderSecrets(page: ReturnType<typeof SecretsPage>) {
  return (current: ESettingsPage) =>
    current === ESettingsPage.Secrets ? page : renderSettingsPage(current)
}

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.Secrets} renderPage={renderSettingsPage} />
  ),
}

export const Empty: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Secrets}
      renderPage={renderSecrets(<SecretsPage initial={[]} />)}
    />
  ),
}

export const AddDialog: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Secrets}
      renderPage={renderSecrets(<SecretsPage openDialog={ESecretsDialog.Add} />)}
    />
  ),
}

export const BulkAddDialog: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Secrets}
      renderPage={renderSecrets(
        <SecretsPage openDialog={ESecretsDialog.BulkAdd} bulkText={BULK_ADD_SAMPLE} />,
      )}
    />
  ),
}
