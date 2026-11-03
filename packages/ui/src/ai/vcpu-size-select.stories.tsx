import type { Meta, StoryObj } from '@storybook/react'

import { VcpuSizeSelect } from './vcpu-size-select'

const SIZES = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]

const meta = {
  title: 'AI/vCPU Size Select',
  component: VcpuSizeSelect,
  args: { sizes: SIZES, value: '2', onValueChange: () => undefined },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VcpuSizeSelect>

export default meta
type Story = StoryObj<typeof meta>

export const SizesOnly: Story = {}

export const WithLeadingOption: Story = {
  args: {
    value: 'default',
    options: [{ value: 'default', label: 'Account default', detail: 'Uses your Sandbox size' }],
  },
}

export const Disabled: Story = { args: { disabled: true } }
