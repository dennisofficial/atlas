import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Queue } from '@dltech/atlas-ui/ai/queue'

import { TODOS } from '../fixtures/agent'

const meta = {
  title: 'AI/Queue',
  component: Queue,
  args: { todos: TODOS },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Queue>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const AllDone: Story = { args: { todos: TODOS.map((todo) => ({ ...todo, done: true })) } }

export const NothingDone: Story = {
  args: { todos: TODOS.map((todo) => ({ ...todo, done: false })) },
}
