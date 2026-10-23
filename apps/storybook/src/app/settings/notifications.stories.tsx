import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { NotificationsPage } from './pages/notifications'

const meta = {
  title: 'App/Settings/Parked/Notifications',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      <NotificationsPage />
    </div>
  ),
}
