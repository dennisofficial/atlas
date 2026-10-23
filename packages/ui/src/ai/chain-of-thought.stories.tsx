import type { Meta, StoryObj } from '@storybook/react'

import { ChainOfThought, EStepStatus } from './chain-of-thought'

const meta = {
  title: 'AI/Chain of Thought',
  component: ChainOfThought,
  args: {
    steps: [
      { id: '1', title: 'Read the build log for dpl_8Kx2' },
      {
        id: '2',
        title: 'Searched the web for next.js image cache key',
        results: [
          'https://nextjs.org/docs/app/api-reference/components/image',
          'https://github.com/vercel/next.js/discussions/1',
        ],
      },
      { id: '3', title: 'Searched the code for cacheKey' },
    ],
    defaultOpen: true,
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChainOfThought>

export default meta

type Story = StoryObj<typeof meta>

export const Done: Story = {}

export const Running: Story = {
  args: {
    steps: [
      { id: '1', title: 'Read the build log for dpl_8Kx2' },
      {
        id: '2',
        title: 'Searching the web for next.js image cache key',
        status: EStepStatus.Running,
      },
    ],
  },
}

export const WithFailure: Story = {
  args: {
    steps: [
      { id: '1', title: 'Read the build log for dpl_8Kx2' },
      { id: '2', title: 'Failed to search the web', status: EStepStatus.Error },
    ],
  },
}
