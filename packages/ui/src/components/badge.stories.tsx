import type { Meta, StoryObj } from '@storybook/react'
import { CheckIcon } from 'lucide-react'

import { Badge } from '#components/badge'
import { Spinner } from '#components/spinner'

const variants = ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const

const meta = {
  title: 'Components/Badge',
  component: Badge,
  argTypes: { variant: { control: 'select', options: variants } },
  args: { children: 'Badge', variant: 'default' },
} satisfies Meta<typeof Badge>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Secondary: Story = { args: { variant: 'secondary', children: 'secondary' } }

export const Destructive: Story = { args: { variant: 'destructive', children: 'destructive' } }

export const Outline: Story = { args: { variant: 'outline', children: 'outline' } }

export const Ghost: Story = { args: { variant: 'ghost', children: 'ghost' } }

export const Link: Story = { args: { variant: 'link', children: 'link' } }

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {variants.map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">
        <CheckIcon data-icon="inline-start" />
        Tests passing
      </Badge>
      <Badge variant="outline">
        <Spinner data-icon="inline-start" />
        Running
      </Badge>
    </div>
  ),
}
