import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import {
  SandboxPage,
  VERCEL_CONFIGURED,
  VERCEL_NOT_CONFIGURED,
  type SandboxVercelState,
} from './pages/sandbox'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'Views/Settings/Sandbox',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const sandboxStory = ({
  vercel,
  empty = false,
}: {
  vercel: SandboxVercelState
  empty?: boolean
}): Story => ({
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Sandbox}
      renderPage={(page) =>
        page === ESettingsPage.Sandbox ? (
          <SandboxPage vercel={vercel} {...(empty ? { running: [], paused: [] } : {})} />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  ),
})

export const Configured: Story = sandboxStory({ vercel: VERCEL_CONFIGURED })

export const NotConfigured: Story = sandboxStory({
  vercel: VERCEL_NOT_CONFIGURED,
  empty: true,
})

export const NoSandboxes: Story = sandboxStory({ vercel: VERCEL_CONFIGURED, empty: true })
