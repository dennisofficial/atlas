import type { Meta, StoryObj } from '@storybook/react-vite'
import { CheckIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

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
