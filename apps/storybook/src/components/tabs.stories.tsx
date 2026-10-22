import type { Meta, StoryObj } from '@storybook/react-vite'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  argTypes: { orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] } },
  args: { orientation: 'horizontal', defaultValue: 'transcript' },
} satisfies Meta<typeof Tabs>

export default meta

type Story = StoryObj<typeof meta>

function Panels() {
  return (
    <>
      <TabsContent value="transcript" className="text-sm text-muted-foreground">
        14 turns, 3 tool calls awaiting approval.
      </TabsContent>
      <TabsContent value="files" className="text-sm text-muted-foreground">
        7 files changed on dennis/shadcn-ui-storybook.
      </TabsContent>
      <TabsContent value="usage" className="text-sm text-muted-foreground">
        182k tokens, $4.21 so far.
      </TabsContent>
    </>
  )
}

export const Default: Story = {
  render: (args) => (
    <Tabs className="w-96" {...args}>
      <TabsList>
        <TabsTrigger value="transcript">Transcript</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="usage">Usage</TabsTrigger>
      </TabsList>
      <Panels />
    </Tabs>
  ),
}

export const Line: Story = {
  render: (args) => (
    <Tabs className="w-96" {...args}>
      <TabsList variant="line">
        <TabsTrigger value="transcript">Transcript</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="usage">Usage</TabsTrigger>
      </TabsList>
      <Panels />
    </Tabs>
  ),
}

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => (
    <Tabs className="w-96" {...args}>
      <TabsList>
        <TabsTrigger value="transcript">Transcript</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="usage">Usage</TabsTrigger>
      </TabsList>
      <Panels />
    </Tabs>
  ),
}

export const WithDisabled: Story = {
  render: (args) => (
    <Tabs className="w-96" {...args}>
      <TabsList>
        <TabsTrigger value="transcript">Transcript</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="usage" disabled>
          Usage
        </TabsTrigger>
      </TabsList>
      <Panels />
    </Tabs>
  ),
}
