import type { Meta, StoryObj } from '@storybook/react'

import { Tool, EToolKind, EToolState } from './tool'
import { WorkSummary } from './work-summary'

import { GIT_STATUS_OUTPUT } from '../fixtures/agent'

const meta = {
  title: 'AI/Work Summary',
  component: WorkSummary,
  args: { duration: '33m', stepCount: 3, children: null },
  decorators: [
    (Story) => (
      <div className="w-[40rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkSummary>

export default meta

type Story = StoryObj<typeof meta>

function Steps() {
  return (
    <>
      <Tool
        kind={EToolKind.Shell}
        label="git status --short"
        state={EToolState.Done}
        output={GIT_STATUS_OUTPUT}
      />
      <Tool kind={EToolKind.Shell} label="bun run typecheck" state={EToolState.Done} />
      <Tool kind={EToolKind.Shell} label="bun run test" state={EToolState.Done} />
    </>
  )
}

export const Finished: Story = {
  render: (args) => (
    <WorkSummary {...args}>
      <Steps />
    </WorkSummary>
  ),
}

export const FinishedOpen: Story = {
  args: { defaultOpen: true },
  render: Finished.render,
}

export const Running: Story = {
  args: { duration: '2m', running: true, stepCount: 3 },
  render: (args) => (
    <WorkSummary {...args}>
      <Steps />
      <Tool kind={EToolKind.Shell} label="bun run build" state={EToolState.Running} />
    </WorkSummary>
  ),
}
