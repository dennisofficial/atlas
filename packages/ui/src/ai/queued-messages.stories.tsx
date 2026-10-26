import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { QueuedMessages, type QueuedMessagesProps } from './queued-messages'
import { FILE_ONLY, MANY_QUEUED, TWO_QUEUED, WITH_IMAGES } from './queued-messages.fixtures'
import { PromptInput } from './prompt-input'
import { removeQueued, saveQueued } from './queued-message-ops'

const noop = () => undefined

const meta = {
  title: 'AI/Queued Messages',
  component: QueuedMessages,
  args: { messages: TWO_QUEUED, onSave: noop, onRemove: noop },
  decorators: [
    (Story) => (
      <div className="flex min-h-[24rem] w-[44rem] max-w-full flex-col justify-end gap-2">
        <Story />
        <PromptInput busy queueWhileBusy placeholder="Queue a message for when Atlas is done…" />
      </div>
    ),
  ],
} satisfies Meta<typeof QueuedMessages>

export default meta

type Story = StoryObj<typeof meta>

export const Two: Story = {}

export const One: Story = { args: { messages: TWO_QUEUED.slice(0, 1) } }

export const Many: Story = { args: { messages: MANY_QUEUED } }

export const WithImages: Story = { args: { messages: WITH_IMAGES } }

export const FileOnly: Story = { args: { messages: FILE_ONLY } }

export const Editing: Story = { args: { editingId: 'q2', onEditingChange: noop } }

export const EditingWithAttachments: Story = {
  args: { messages: [...TWO_QUEUED, ...WITH_IMAGES], editingId: 'w1', onEditingChange: noop },
}

function InteractiveQueue(args: QueuedMessagesProps) {
  const [messages, setMessages] = useState(args.messages)
  const handleSave = (save: Parameters<QueuedMessagesProps['onSave']>[0]) =>
    setMessages((queue) => saveQueued({ queue, ...save }))
  const handleRemove = (id: string) => setMessages((queue) => removeQueued({ queue, id }))
  return (
    <QueuedMessages {...args} messages={messages} onSave={handleSave} onRemove={handleRemove} />
  )
}

export const Interactive: Story = {
  args: { messages: [...TWO_QUEUED, ...WITH_IMAGES] },
  render: (args) => <InteractiveQueue {...args} />,
}
