import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@dltech/atlas-ui/components/card'

const meta = {
  title: 'Components/Card',
  component: Card,
  argTypes: { size: { control: 'inline-radio', options: ['default', 'sm'] } },
  args: { size: 'default' },
} satisfies Meta<typeof Card>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Card className="w-96" {...args}>
      <CardHeader>
        <CardTitle>fix flaky ws reconnect</CardTitle>
        <CardDescription>atlas · dennis/ws-reconnect · 14 turns</CardDescription>
        <CardAction>
          <Badge variant="secondary">Running</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The client retries three times with backoff, then surfaces a disconnected banner. Two specs
        still race on the reconnect timer.
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm">Open</Button>
        <Button size="sm" variant="outline">
          Stop
        </Button>
      </CardFooter>
    </Card>
  ),
}

export const Small: Story = {
  args: { size: 'sm' },
  render: Default.render,
}

export const ContentOnly: Story = {
  render: (args) => (
    <Card className="w-96" {...args}>
      <CardContent className="text-sm">
        3 tool calls awaiting approval in <span className="font-mono">apps/web</span>.
      </CardContent>
    </Card>
  ),
}
