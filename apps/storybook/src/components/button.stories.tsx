import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Button } from '@dltech/atlas-ui/components/button'

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
