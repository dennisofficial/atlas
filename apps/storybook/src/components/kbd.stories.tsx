import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Kbd, KbdGroup } from '@dltech/atlas-ui/components/kbd'

const meta = {
  title: 'Components/Kbd',
  component: Kbd,
  args: { children: 'K' },
} satisfies Meta<typeof Kbd>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Combination: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      Open the command palette
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </div>
  ),
}
