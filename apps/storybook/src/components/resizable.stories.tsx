import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@dltech/atlas-ui/components/resizable'

const meta = {
  title: 'Components/Resizable',
  component: ResizablePanelGroup,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ResizablePanelGroup>

export default meta

type Story = StoryObj<typeof meta>

function Pane({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center p-4 font-mono text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export const Horizontal: Story = {
  render: () => (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-64 w-[32rem] rounded-lg border border-border"
    >
      <ResizablePanel defaultSize={30} minSize={15}>
        <Pane label="Sessions" />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={70}>
        <Pane label="Transcript" />
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
}

export const Vertical: Story = {
  render: () => (
    <ResizablePanelGroup
      orientation="vertical"
      className="h-64 w-[24rem] rounded-lg border border-border"
    >
      <ResizablePanel defaultSize={60}>
        <Pane label="Editor" />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={40}>
        <Pane label="Terminal" />
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
}
