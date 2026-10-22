import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

const meta = {
  title: 'Components/Toggle Group',
  component: ToggleGroup,
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'outline'] },
    size: { control: 'inline-radio', options: ['default', 'sm', 'lg'] },
    spacing: { control: { type: 'number', min: 0, max: 4 } },
  },
  args: { variant: 'outline', size: 'default', spacing: 0 },
} satisfies Meta<typeof ToggleGroup>

export default meta

type Story = StoryObj<typeof meta>

export const Single: Story = {
  render: (args) => (
    <ToggleGroup defaultValue={['left']} {...args}>
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const Multiple: Story = {
  render: (args) => (
    <ToggleGroup multiple defaultValue={['tools', 'reasoning']} {...args}>
      <ToggleGroupItem value="tools">Tools</ToggleGroupItem>
      <ToggleGroupItem value="reasoning">Reasoning</ToggleGroupItem>
      <ToggleGroupItem value="usage">Usage</ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const Spaced: Story = {
  args: { spacing: 2, variant: 'outline' },
  render: Multiple.render,
}

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: Multiple.render,
}

export const Disabled: Story = {
  render: (args) => (
    <ToggleGroup disabled {...args}>
      <ToggleGroupItem value="a">Tools</ToggleGroupItem>
      <ToggleGroupItem value="b">Reasoning</ToggleGroupItem>
    </ToggleGroup>
  ),
}
