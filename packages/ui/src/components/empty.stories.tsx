import type { Meta, StoryObj } from '@storybook/react'
import { SquareTerminalIcon } from 'lucide-react'

import { Button } from '#components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/empty'

const meta = {
  title: 'Components/Empty',
  component: Empty,
  argTypes: { variant: { control: 'inline-radio', options: ['default', 'outline'] } },
} satisfies Meta<typeof Empty>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Empty className="w-[28rem]" variant="outline" {...args}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SquareTerminalIcon />
        </EmptyMedia>
        <EmptyTitle>No sessions yet</EmptyTitle>
        <EmptyDescription>
          Start a session to let Atlas work on a branch. It shows up here with its transcript.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>New session</Button>
      </EmptyContent>
    </Empty>
  ),
}

export const NoMedia: Story = {
  render: (args) => (
    <Empty className="w-[28rem]" {...args}>
      <EmptyHeader>
        <EmptyTitle>No results for “websocket”</EmptyTitle>
        <EmptyDescription>Try a different term or clear the filters.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline">Clear filters</Button>
      </EmptyContent>
    </Empty>
  ),
}

export const Outline: Story = {
  args: { variant: 'outline' },
  render: (args) => (
    <Empty className="w-[28rem]" {...args}>
      <EmptyHeader>
        <EmptyTitle>No API keys</EmptyTitle>
        <EmptyDescription>Create a key to use Atlas from CI.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
}
