import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'

import {
  EViewportKind,
  FULL_VIEWPORT,
  PreviewBrowser,
  type PreviewBrowserProps,
  type PreviewBrowserTab,
  type Viewport,
} from './preview-browser'
import { PreviewNewTab, PreviewOffline } from './preview-new-tab'
import { EPreviewStatus, type PreviewPort } from './preview-ports'

const WEB: PreviewPort = {
  id: 'web',
  port: 3000,
  label: 'Web app',
  url: 'https://3000-abc1234567.byatlas.dev',
  status: EPreviewStatus.Live,
}

const STORYBOOK: PreviewPort = {
  id: 'storybook',
  port: 6006,
  label: 'Storybook',
  url: 'https://6006-abc1234567.byatlas.dev',
  status: EPreviewStatus.Starting,
}

const API: PreviewPort = {
  id: 'api',
  port: 4000,
  label: 'API',
  url: 'https://4000-abc1234567.byatlas.dev',
  status: EPreviewStatus.Stopped,
}

const PORTS: PreviewPort[] = [WEB, STORYBOOK, API]
const TABS: PreviewBrowserTab[] = [
  { id: 't1', title: 'Web app', url: WEB.url, status: EPreviewStatus.Live },
  { id: 't2', title: 'Storybook', url: STORYBOOK.url, status: EPreviewStatus.Starting },
  { id: 't3', title: 'New tab', url: '' },
]

function Page() {
  return (
    <div className="flex size-full items-center justify-center bg-background text-sm text-muted-foreground">
      The page renders here
    </div>
  )
}

function Controlled(props: PreviewBrowserProps) {
  const [activeId, setActiveId] = useState(props.activeId)
  const [viewport, setViewport] = useState<Viewport>(props.viewport)
  return (
    <PreviewBrowser
      {...props}
      activeId={activeId}
      onActivate={setActiveId}
      viewport={viewport}
      onViewportChange={setViewport}
    />
  )
}

const meta = {
  title: 'AI/Preview Browser',
  component: PreviewBrowser,
  args: {
    tabs: TABS,
    activeId: 't1',
    onActivate: () => undefined,
    onClose: () => undefined,
    onOpen: () => undefined,
    address: WEB.url,
    canGoBack: true,
    canGoForward: false,
    canReload: true,
    onBack: () => undefined,
    onForward: () => undefined,
    onReload: () => undefined,
    onAddress: () => undefined,
    viewport: FULL_VIEWPORT,
    onViewportChange: () => undefined,
    children: <Page />,
  },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="flex h-[32rem] w-[44rem] overflow-hidden rounded-lg border border-border bg-card">
        <div className="min-w-0 flex-1">
          <Story />
        </div>
      </div>
    ),
  ],
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof PreviewBrowser>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

const TABLET: Viewport = { kind: EViewportKind.Fixed, width: 768, height: 1024 }

export const ScaledDevice: Story = { args: { viewport: TABLET } }

export const NewTab: Story = {
  args: {
    activeId: 't3',
    address: '',
    canGoBack: false,
    canReload: false,
    children: <PreviewNewTab ports={PORTS} onOpen={() => undefined} />,
  },
}

export const Offline: Story = {
  args: {
    activeId: 't2',
    address: STORYBOOK.url,
    children: <PreviewOffline port={STORYBOOK} />,
  },
}
