import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import {
  CHATGPT_SUBSCRIPTION_NEAR_LIMIT,
  CLAUDE_SUBSCRIPTION_NEAR_LIMIT,
} from '@dltech/atlas-ui/fixtures/settings-agent'
import { ProvidersPage } from './pages/providers'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'App/Settings/Providers',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const providersStory = (page: React.ReactNode): Story => ({
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Providers}
      renderPage={(current) =>
        current === ESettingsPage.Providers ? page : renderSettingsPage(current)
      }
    />
  ),
})

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.Providers} renderPage={renderSettingsPage} />
  ),
}

export const BothConnected: Story = providersStory(<ProvidersPage chatgptConnectedInitially />)

export const NearLimit: Story = providersStory(
  <ProvidersPage
    claude={CLAUDE_SUBSCRIPTION_NEAR_LIMIT}
    chatgpt={CHATGPT_SUBSCRIPTION_NEAR_LIMIT}
    chatgptConnectedInitially
  />,
)
