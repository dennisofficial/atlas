import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '#components/button'

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Button' },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

const variants = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const

const sizes = ['xs', 'sm', 'default', 'lg'] as const

export const Default: Story = {}

export const Outline: Story = { args: { variant: 'outline', children: 'outline' } }

export const Secondary: Story = { args: { variant: 'secondary', children: 'secondary' } }

export const Ghost: Story = { args: { variant: 'ghost', children: 'ghost' } }

export const Destructive: Story = { args: { variant: 'destructive', children: 'destructive' } }

export const Link: Story = { args: { variant: 'link', children: 'link' } }

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {variants.map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
}

export const ExtraSmall: Story = { args: { size: 'xs', children: 'xs' } }

export const Small: Story = { args: { size: 'sm', children: 'sm' } }

export const Large: Story = { args: { size: 'lg', children: 'lg' } }

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {sizes.map((size) => (
        <Button key={size} size={size}>
          {size}
        </Button>
      ))}
    </div>
  ),
}
