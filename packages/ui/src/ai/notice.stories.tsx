import { FolderIcon, TerminalIcon } from 'lucide-react'
import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '#components/button'
import { Notice } from './notice'

const meta = {
  title: 'AI/Notice',
  component: Notice,
  args: {
    icon: <FolderIcon />,
    title: 'No files yet',
    description: 'This workspace has no project files.',
  },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="flex h-64 w-80 rounded-lg border border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Notice>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithAction: Story = {
  args: {
    icon: <TerminalIcon />,
    title: 'No pod yet',
    description: 'Send a message to start a pod, then open a shell in it.',
    action: <Button size="sm">Start pod</Button>,
  },
}
