import type { Meta, StoryObj } from '@storybook/react-vite'

import { SecurityPage } from './pages/security'

const meta = {
  title: 'Views/Settings/Parked/Devices & Sessions',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-3xl px-8 py-10">
      <SecurityPage />
    </div>
  ),
}
