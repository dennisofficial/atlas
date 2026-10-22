import type { Meta, StoryObj } from '@storybook/react-vite'

import { Separator } from '@dltech/atlas-ui/components/separator'

const meta = {
  title: 'Components/Separator',
  component: Separator,
  argTypes: { orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] } },
} satisfies Meta<typeof Separator>

export default meta

type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-3">
      <div>
        <h4 className="text-sm font-semibold">Atlas</h4>
        <p className="text-sm text-muted-foreground">A coding-agent harness.</p>
      </div>
      <Separator />
      <p className="text-sm">Sessions, tools, and plugins.</p>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-5 items-center gap-3 text-sm">
      <span>Sessions</span>
      <Separator orientation="vertical" />
      <span>Tools</span>
      <Separator orientation="vertical" />
      <span>Plugins</span>
    </div>
  ),
}
