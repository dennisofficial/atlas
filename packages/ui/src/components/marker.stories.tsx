import type { Meta, StoryObj } from '@storybook/react'
import { WrenchIcon } from 'lucide-react'

import { Marker, MarkerContent, MarkerIcon } from '#components/marker'

const meta = {
  title: 'Components/Marker',
  component: Marker,
  argTypes: { variant: { control: 'inline-radio', options: ['default', 'separator', 'border'] } },
  args: { variant: 'separator' },
  decorators: [
    (Story) => (
      <div className="w-[28rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Marker>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Marker {...args}>
      <MarkerContent>Today</MarkerContent>
    </Marker>
  ),
}

const renderVariantMarker: Story['render'] = (args) => (
  <Marker {...args}>
    <MarkerIcon>
      <WrenchIcon />
    </MarkerIcon>
    <MarkerContent>Context compacted · {args.variant}</MarkerContent>
  </Marker>
)

export const DefaultVariant: Story = { args: { variant: 'default' }, render: renderVariantMarker }

export const Border: Story = { args: { variant: 'border' }, render: renderVariantMarker }

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {(['default', 'separator', 'border'] as const).map((variant) => (
        <Marker key={variant} variant={variant}>
          <MarkerIcon>
            <WrenchIcon />
          </MarkerIcon>
          <MarkerContent>Context compacted · {variant}</MarkerContent>
        </Marker>
      ))}
    </div>
  ),
}
