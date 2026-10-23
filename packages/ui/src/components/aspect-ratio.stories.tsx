import type { Meta, StoryObj } from '@storybook/react'

import { AspectRatio } from '#components/aspect-ratio'

const meta = {
  title: 'Components/Aspect Ratio',
  component: AspectRatio,
  argTypes: { ratio: { control: { type: 'number', min: 0.5, max: 3, step: 0.05 } } },
  args: { ratio: 16 / 9 },
} satisfies Meta<typeof AspectRatio>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="w-80">
      <AspectRatio
        {...args}
        className="flex items-center justify-center rounded-lg border border-border bg-muted font-mono text-sm text-muted-foreground"
      >
        Preview · 16:9
      </AspectRatio>
    </div>
  ),
}

export const Square: Story = {
  args: { ratio: 1 },
  render: (args) => (
    <div className="w-48">
      <AspectRatio
        {...args}
        className="flex items-center justify-center rounded-lg border border-border bg-muted font-mono text-sm text-muted-foreground"
      >
        1:1
      </AspectRatio>
    </div>
  ),
}
