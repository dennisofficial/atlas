import type { Meta, StoryObj } from '@storybook/react'
import { CopyIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Kbd } from '#components/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#components/tooltip'

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof Tooltip>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Tooltip {...args}>
      <TooltipTrigger
        render={<Button variant="outline" size="icon" aria-label="Copy session ID" />}
      >
        <CopyIcon />
      </TooltipTrigger>
      <TooltipContent>Copy session ID</TooltipContent>
    </Tooltip>
  ),
}

export const Sides: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Tooltip key={side}>
          <TooltipTrigger render={<Button variant="outline" />}>{side}</TooltipTrigger>
          <TooltipContent side={side}>Tooltip on the {side}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
}

export const WithShortcut: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" />}>Save</TooltipTrigger>
      <TooltipContent>
        Save <Kbd>⌘S</Kbd>
      </TooltipContent>
    </Tooltip>
  ),
}
