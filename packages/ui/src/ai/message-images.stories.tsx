import type { Meta, StoryObj } from '@storybook/react'

import { EMessageImageSize, MessageImageThumb, MessageImages } from './message-images'

const swatch = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="${fill}"/></svg>`,
  )}`

const meta = {
  title: 'AI/MessageImages',
  component: MessageImages,
  args: {
    images: [
      { id: '1', src: swatch('#3b3530'), alt: 'screenshot.png' },
      { id: '2', src: swatch('#7a6a5c'), alt: 'mermaid.png' },
    ],
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageImages>

export default meta

type Story = StoryObj<typeof meta>

export const Pasted: Story = {}

export const ToolPreview: Story = {
  render: (args) => (
    <MessageImageThumb
      image={args.images[0] ?? { id: '1', src: swatch('#3b3530'), alt: 'screenshot.png' }}
      size={EMessageImageSize.Preview}
    />
  ),
}
