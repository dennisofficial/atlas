import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import { PreviewFrame, type PreviewFrameProps } from './preview-frame'
import { EPreviewStatus, type PreviewPort } from './preview-ports'

const PORTS: PreviewPort[] = [
  {
    id: 'storybook',
    port: 6006,
    label: 'Storybook',
    url: 'https://6006-thr-ui-rebase.preview.atlas.dev',
    frameSrc: 'about:blank',
    status: EPreviewStatus.Live,
  },
  {
    id: 'web',
    port: 3000,
    label: 'Web app',
    url: 'https://3000-thr-ui-rebase.preview.atlas.dev',
    status: EPreviewStatus.Starting,
  },
  {
    id: 'api',
    port: 4000,
    label: 'API',
    url: 'https://4000-thr-ui-rebase.preview.atlas.dev',
    status: EPreviewStatus.Stopped,
  },
]

function Controlled(props: PreviewFrameProps) {
  const [selectedId, setSelectedId] = useState(props.selectedId)
  return <PreviewFrame {...props} selectedId={selectedId} onSelect={setSelectedId} />
}

const meta = {
  title: 'AI/Preview Frame',
  component: PreviewFrame,
  args: { ports: PORTS, selectedId: 'storybook', onSelect: () => undefined },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="h-[28rem] w-[36rem] overflow-hidden rounded-lg border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof PreviewFrame>

export default meta
type Story = StoryObj<typeof meta>

export const Live: Story = {}

export const Starting: Story = { args: { selectedId: 'web' } }

export const Stopped: Story = { args: { selectedId: 'api' } }

export const SinglePort: Story = { args: { ports: PORTS.slice(0, 1) } }
