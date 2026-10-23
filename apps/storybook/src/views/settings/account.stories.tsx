import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import {
  SIGN_IN_METHODS_GOOGLE_ONLY,
  SIGN_IN_METHODS_PASSWORD_ONLY,
  type SignInMethods,
} from '../../fixtures/settings-account'
import { AccountPage } from './pages/account'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'Views/Settings/Account',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function AccountWithMethods({ signInMethods }: { signInMethods: SignInMethods }) {
  return (
    <SettingsShell
      initialPage={ESettingsPage.Account}
      renderPage={(page) =>
        page === ESettingsPage.Account ? (
          <AccountPage signInMethods={signInMethods} />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  )
}

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.Account} renderPage={renderSettingsPage} />
  ),
}

export const GoogleOnly: Story = {
  render: () => <AccountWithMethods signInMethods={SIGN_IN_METHODS_GOOGLE_ONLY} />,
}

export const PasswordOnly: Story = {
  render: () => <AccountWithMethods signInMethods={SIGN_IN_METHODS_PASSWORD_ONLY} />,
}
