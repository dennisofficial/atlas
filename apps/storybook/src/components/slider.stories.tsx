import type { Meta, StoryObj } from '@storybook/react-vite'

import { Slider } from '@dltech/atlas-ui/components/slider'

const meta = {
  title: 'Components/Slider',
  component: Slider,
  argTypes: { disabled: { control: 'boolean' }, step: { control: 'number' } },
  args: { defaultValue: [40], max: 100, step: 1 },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Slider>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Range: Story = { args: { defaultValue: [20, 70] } }

export const Disabled: Story = { args: { disabled: true } }

export const Vertical: Story = {
  args: { orientation: 'vertical', defaultValue: [60] },
  decorators: [
    (Story) => (
      <div className="h-40">
        <Story />
      </div>
    ),
  ],
}
