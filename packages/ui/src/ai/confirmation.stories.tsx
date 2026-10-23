import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { Confirmation, EConfirmationState } from './confirmation'
import { Button } from '#components/button'

const meta = {
  title: 'AI/Confirmation',
  component: Confirmation,
  args: {
    title: 'Run rm -rf node_modules?',
    description: 'The command runs in this project and cannot be undone.',
  },
  argTypes: {
    state: { control: 'select', options: Object.values(EConfirmationState) },
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Confirmation>

export default meta

type Story = StoryObj<typeof meta>

export const Pending: Story = {}

export const WithEvidence: Story = {
  args: {
    evidence: ['matched rule: recursive delete', 'cwd: /work/atlas', 'not on the allow list'],
    onApproveAlways: () => {},
  },
}

export const Approved: Story = { args: { state: EConfirmationState.Approved } }

export const Denied: Story = { args: { state: EConfirmationState.Denied } }

function InteractiveConfirmation() {
  const [state, setState] = useState(EConfirmationState.Pending)
  const handleApprove = () => setState(EConfirmationState.Approved)
  const handleDeny = () => setState(EConfirmationState.Denied)
  const handleReset = () => setState(EConfirmationState.Pending)

  return (
    <div className="flex flex-col items-start gap-3">
      <Confirmation
        title="Run rm -rf node_modules?"
        description="Focus the card and press Enter to approve, Esc to deny, a to always allow."
        evidence={['matched rule: recursive delete']}
        state={state}
        onApprove={handleApprove}
        onDeny={handleDeny}
        onApproveAlways={handleApprove}
      />
      <Button variant="outline" size="sm" onClick={handleReset}>
        Reset
      </Button>
    </div>
  )
}

export const Interactive: Story = { render: () => <InteractiveConfirmation /> }
