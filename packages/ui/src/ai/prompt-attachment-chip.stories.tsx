import type { Meta, StoryObj } from '@storybook/react'

import { AttachmentGroup } from '#components/attachment'

import { EPromptAttachmentStatus, PromptAttachmentChip } from './prompt-attachment-chip'

const meta = {
  title: 'AI/Prompt Attachment Chip',
  component: PromptAttachmentChip,
  decorators: [
    (Story) => (
      <AttachmentGroup>
        <Story />
      </AttachmentGroup>
    ),
  ],
} satisfies Meta<typeof PromptAttachmentChip>

export default meta

type Story = StoryObj<typeof meta>

export const Ready: Story = {
  args: { attachment: { id: '1', name: 'notes.pdf', status: EPromptAttachmentStatus.Ready } },
}

export const Uploading: Story = {
  args: {
    attachment: {
      id: '2',
      name: 'report.pdf',
      status: EPromptAttachmentStatus.Uploading,
      progress: 0.4,
    },
  },
}

export const Failed: Story = {
  args: { attachment: { id: '3', name: 'huge.zip', status: EPromptAttachmentStatus.Failed } },
}
