import type { Meta, StoryObj } from '@storybook/react'

import { EStepStatus, type PlanStep } from './plan'
import { PlanSummary } from './plan-summary'

const STEPS: PlanStep[] = [
  { id: '1', title: 'Read the spec', status: EStepStatus.Done },
  { id: '2', title: 'Writing the folds', status: EStepStatus.Running },
  { id: '3', title: 'Ship it', status: EStepStatus.Pending },
]

const meta = {
  title: 'AI/Plan Summary',
  component: PlanSummary,
  args: { steps: STEPS, onOpen: () => undefined },
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PlanSummary>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {}

export const Done: Story = {
  args: { steps: STEPS.map((step) => ({ ...step, status: EStepStatus.Done })) },
}

export const Failed: Story = {
  args: { steps: [STEPS[0]!, { id: '2', title: 'Typecheck', status: EStepStatus.Error }] },
}
