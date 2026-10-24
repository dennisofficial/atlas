import type { Meta, StoryObj } from '@storybook/react'

import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from '#components/bubble'

const variants = [
  'default',
  'secondary',
  'muted',
  'tinted',
  'outline',
  'ghost',
  'destructive',
] as const

const meta = {
  title: 'Components/Bubble',
  component: Bubble,
  argTypes: {
    variant: { control: 'select', options: variants },
    align: { control: 'inline-radio', options: ['start', 'end'] },
  },
  args: { variant: 'secondary', align: 'start' },
  decorators: [
    (Story) => (
      <div className="w-[28rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Bubble>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Bubble {...args}>
      <BubbleContent>Can you rename the session store and update its imports?</BubbleContent>
    </Bubble>
  ),
}

const renderVariantBubble: Story['render'] = (args) => (
  <Bubble {...args}>
    <BubbleContent>{args.variant}</BubbleContent>
  </Bubble>
)

export const DefaultVariant: Story = { args: { variant: 'default' }, render: renderVariantBubble }

export const Muted: Story = { args: { variant: 'muted' }, render: renderVariantBubble }

export const Tinted: Story = { args: { variant: 'tinted' }, render: renderVariantBubble }

export const Outline: Story = { args: { variant: 'outline' }, render: renderVariantBubble }

export const Ghost: Story = { args: { variant: 'ghost' }, render: renderVariantBubble }

export const Destructive: Story = { args: { variant: 'destructive' }, render: renderVariantBubble }

export const Variants: Story = {
  render: () => (
    <BubbleGroup>
      {variants.map((variant) => (
        <Bubble key={variant} variant={variant}>
          <BubbleContent>{variant}</BubbleContent>
        </Bubble>
      ))}
    </BubbleGroup>
  ),
}

export const Reply: Story = {
  render: () => (
    <BubbleGroup>
      <Bubble variant="muted">
        <BubbleContent>Renamed 3 files and updated 11 imports.</BubbleContent>
        <BubbleReactions>👍 2</BubbleReactions>
      </Bubble>
      <Bubble variant="default" align="end">
        <BubbleContent>Run the typecheck too.</BubbleContent>
      </Bubble>
    </BubbleGroup>
  ),
}
