import type { Meta, StoryObj } from '@storybook/react-vite'

import { Checkbox } from '@dltech/atlas-ui/components/checkbox'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'

const meta = {
  title: 'Components/Label',
  component: Label,
  args: { children: 'Repository' },
} satisfies Meta<typeof Label>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-2">
      <Label htmlFor="label-repo" {...args} />
      <Input id="label-repo" placeholder="owner/repo" />
    </div>
  ),
}

export const WithCheckbox: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="label-terms" />
      <Label htmlFor="label-terms">Accept the sandbox terms</Label>
    </div>
  ),
}
