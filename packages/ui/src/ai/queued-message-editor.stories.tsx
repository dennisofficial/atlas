import type { Meta, StoryObj } from '@storybook/react'

import { QueuedMessageEditor } from './queued-message-editor'
import { SCREENSHOTS, SPEC_PDF } from './queued-messages.fixtures'

const noop = () => undefined

const meta = {
  title: 'AI/Queued Message Editor',
  component: QueuedMessageEditor,
  args: {
    initial: { text: 'Squash the commits before opening the PR', attachments: [] },
    onSave: noop,
    onCancel: noop,
  },
  decorators: [
    (Story) => (
      <div className="flex w-[44rem] max-w-full justify-end">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QueuedMessageEditor>

export default meta

type Story = StoryObj<typeof meta>

export const Text: Story = {}

export const Empty: Story = { args: { initial: { text: '', attachments: [] } } }

export const WithImages: Story = {
  args: { initial: { text: 'Match the spacing in the mock', attachments: SCREENSHOTS } },
}

export const WithFile: Story = {
  args: { initial: { text: '', attachments: [SPEC_PDF] } },
}
