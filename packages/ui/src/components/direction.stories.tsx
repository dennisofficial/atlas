import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '#components/button'
import { DirectionProvider } from '#components/direction'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '#components/item'

const meta = {
  title: 'Components/Direction',
  component: DirectionProvider,
  argTypes: { direction: { control: 'inline-radio', options: ['ltr', 'rtl'] } },
  args: { direction: 'rtl' },
} satisfies Meta<typeof DirectionProvider>

export default meta

type Story = StoryObj<typeof meta>

export const Rtl: Story = {
  render: (args) => (
    <DirectionProvider {...args}>
      <div dir={args.direction} className="w-96">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Session paused</ItemTitle>
            <ItemDescription>Waiting for approval to run bash.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="sm">Approve</Button>
          </ItemActions>
        </Item>
      </div>
    </DirectionProvider>
  ),
}

export const Ltr: Story = { args: { direction: 'ltr' }, render: Rtl.render }
