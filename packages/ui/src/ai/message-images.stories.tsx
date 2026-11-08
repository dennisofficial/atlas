import type { Meta, StoryObj } from '@storybook/react'

import { MessageAttachments, EMessageImageSize, MessageImageThumb } from './message-images'

const swatch = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="${fill}"/></svg>`,
  )}`

const meta = {
  title: 'AI/MessageImages',
  component: MessageAttachments,
  args: {
    attachments: [
      { id: '1', name: 'screenshot.png', src: swatch('#3b3530') },
      { id: '2', name: 'mermaid.png', src: swatch('#7a6a5c') },
    ],
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageAttachments>

export default meta

type Story = StoryObj<typeof meta>

export const Pasted: Story = {}

export const WithFiles: Story = {
  args: {
    attachments: [
      ...(meta.args.attachments ?? []),
      { id: 'f1', name: 'deploy.sh' },
      { id: 'f2', name: 'a-very-long-migration-plan-for-the-database.md' },
    ],
  },
}

export const ToolPreview: Story = {
  render: () => (
    <MessageImageThumb
      image={{ id: '1', src: swatch('#3b3530'), alt: 'screenshot.png' }}
      size={EMessageImageSize.Preview}
    />
  ),
}
