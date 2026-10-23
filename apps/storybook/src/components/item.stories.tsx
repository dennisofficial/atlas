import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ChevronRightIcon, GitBranchIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@dltech/atlas-ui/components/item'

const meta = {
  title: 'Components/Item',
  component: Item,
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'outline', 'muted'] },
    size: { control: 'inline-radio', options: ['default', 'sm', 'xs'] },
  },
  args: { variant: 'outline', size: 'default' },
  decorators: [
    (Story) => (
      <div className="w-[28rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Item>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Item {...args}>
      <ItemMedia variant="icon">
        <GitBranchIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>dennis/shadcn-ui-storybook</ItemTitle>
        <ItemDescription>14 turns · last active 3 minutes ago</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline">
          Open
        </Button>
      </ItemActions>
    </Item>
  ),
}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['default', 'outline', 'muted'] as const).map((variant) => (
        <Item key={variant} variant={variant}>
          <ItemContent>
            <ItemTitle>{variant}</ItemTitle>
            <ItemDescription>Item with the {variant} variant.</ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </div>
  ),
}

export const List: Story = {
  render: () => (
    <ItemGroup className="rounded-lg border border-border">
      {[
        { title: 'fix flaky ws reconnect', state: 'Running' },
        { title: 'add storybook coverage spec', state: 'Waiting' },
        { title: 'migrate web to shadcn', state: 'Done' },
      ].map((session, index) => (
        <div key={session.title}>
          {index > 0 && <ItemSeparator />}
          <Item render={<a href="#" />}>
            <ItemContent>
              <ItemTitle>{session.title}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Badge variant="secondary">{session.state}</Badge>
              <ChevronRightIcon className="size-4" />
            </ItemActions>
          </Item>
        </div>
      ))}
    </ItemGroup>
  ),
}
