import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { EStepStatus, EToolKind, Task } from '@dltech/atlas-ui/ai/task'

const meta = {
  title: 'AI/Task',
  component: Task,
  args: {
    title: 'Found the project files',
    defaultOpen: true,
    steps: [
      { id: '1', kind: EToolKind.Search, label: 'app/page.tsx' },
      {
        id: '2',
        kind: EToolKind.Read,
        label: 'app/page.tsx',
        href: 'https://example.com/files/app/page.tsx',
      },
    ],
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Task>

export default meta

type Story = StoryObj<typeof meta>

export const Done: Story = {}

export const Running: Story = {
  args: {
    title: 'Updating the page metadata',
    status: EStepStatus.Running,
    steps: [
      { id: '1', kind: EToolKind.Read, label: 'app/layout.tsx' },
      { id: '2', kind: EToolKind.Edit, label: 'app/layout.tsx', status: EStepStatus.Running },
    ],
  },
}

export const Failed: Story = {
  args: {
    title: 'Failed to update the page metadata',
    status: EStepStatus.Error,
    steps: [
      { id: '1', kind: EToolKind.Read, label: 'app/layout.tsx' },
      { id: '2', kind: EToolKind.Edit, label: 'app/layout.tsx', status: EStepStatus.Error },
    ],
  },
}
