import type { Meta, StoryObj } from '@storybook/react'

import { EStepStatus, Plan } from './plan'

import { PLAN_STEPS } from '../fixtures/agent'

const meta = {
  title: 'AI/Plan',
  component: Plan,
  args: { title: 'Plan: rebase ui on shadcn', steps: PLAN_STEPS },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Plan>

export default meta

type Story = StoryObj<typeof meta>

export const InProgress: Story = {}

export const WithDescription: Story = {
  args: { description: 'Tokens stay TS-generated so the same values can drive a native app.' },
}

export const Complete: Story = {
  args: { steps: PLAN_STEPS.map((step) => ({ ...step, status: EStepStatus.Done })) },
}

export const Collapsed: Story = { args: { defaultOpen: false } }
