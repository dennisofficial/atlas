import type { Meta, StoryObj } from '@storybook/react'

import { QueuedNotices } from './queued-notices'
import { TWO_QUEUED } from './queued-messages.fixtures'
import { QueuedMessages } from './queued-messages'
import { PromptInput } from './prompt-input'

const noop = () => undefined

const NOTICES = [
  { id: 'n1', text: 'Sub-agent fix the flaky spec finished after 4 turns and 12 tool calls' },
  { id: 'n2', text: 'Background shell "bun test" completed (exit code 0)' },
  { id: 'n3', text: 'PR #1284: CI finished, typecheck failed', failed: true },
]

const meta = {
  title: 'AI/Queued Notices',
  component: QueuedNotices,
  args: { notices: NOTICES },
  decorators: [
    (Story) => (
      <div className="flex min-h-[20rem] w-[44rem] max-w-full flex-col justify-end gap-2">
        <Story />
        <QueuedMessages messages={TWO_QUEUED} onSave={noop} onRemove={noop} />
        <PromptInput busy queueWhileBusy placeholder="Queue a message for when Atlas is done…" />
      </div>
    ),
  ],
} satisfies Meta<typeof QueuedNotices>

export default meta

type Story = StoryObj<typeof meta>

export const Notices: Story = {}

export const One: Story = { args: { notices: NOTICES.slice(0, 1) } }

export const Long: Story = {
  args: {
    notices: [
      {
        id: 'n1',
        text: 'Sub-agent fix the flaky spec in the queue path by reading every spec that touches pending inputs before it writes a single line of the fix',
      },
    ],
  },
}

export const Failed: Story = { args: { notices: NOTICES.slice(2) } }

export const Empty: Story = { args: { notices: [] } }
