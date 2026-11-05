import type { Meta, StoryObj } from '@storybook/react'

import { PreviewNewTab } from './preview-new-tab'
import { EPreviewStatus, type PreviewPort } from './preview-ports'

const PORTS: PreviewPort[] = [
  {
    id: 'web',
    port: 3000,
    label: 'Web app',
    url: 'https://3000-abc1234567.byatlas.dev',
    status: EPreviewStatus.Live,
  },
  {
    id: 'storybook',
    port: 6006,
    label: 'Storybook',
    url: 'https://6006-abc1234567.byatlas.dev',
    status: EPreviewStatus.Starting,
  },
  {
    id: 'api',
    port: 4000,
    label: 'API',
    url: 'https://4000-abc1234567.byatlas.dev',
    status: EPreviewStatus.Stopped,
  },
]

const meta = {
  title: 'AI/Preview New Tab',
  component: PreviewNewTab,
  args: { ports: PORTS, onOpen: () => undefined },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="h-96 w-[32rem] overflow-hidden rounded-lg border border-border bg-card">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PreviewNewTab>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoPorts: Story = { args: { ports: [] } }
