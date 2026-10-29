import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { NamingTitle } from './naming-title'

const meta = {
  title: 'AI/Naming Title',
  component: NamingTitle,
  args: { title: null, naming: true },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-80 text-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NamingTitle>

export default meta
type Story = StoryObj<typeof meta>

export const Generating: Story = {}

export const Streaming: Story = {
  render: function StreamingStory() {
    const [title, setTitle] = useState<string | null>(null)
    useEffect(() => {
      const timer = setTimeout(() => setTitle('Wire the model picker into the composer'), 2_000)
      return () => clearTimeout(timer)
    }, [])
    return <NamingTitle title={title} naming={title === null} />
  },
}

export const Titled: Story = {
  args: { title: 'Wire the model picker', naming: false },
}

export const Untitled: Story = { args: { title: null, naming: false } }

export const ReducedMotion: Story = {
  name: 'Reduced motion (enable prefers-reduced-motion to see "Naming…")',
}
