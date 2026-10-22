import type { Meta, StoryObj } from '@storybook/react-vite'

import { Sources } from '@dltech/atlas-ui/ai/sources'

import { SOURCES } from '../fixtures/agent'

const meta = {
  title: 'AI/Sources',
  component: Sources,
  args: { sources: SOURCES },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sources>

export default meta

type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}

export const Open: Story = { args: { defaultOpen: true } }

export const Deduped: Story = { args: { defaultOpen: true, sources: [...SOURCES, ...SOURCES] } }
