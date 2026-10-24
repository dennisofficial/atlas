import type { Meta, StoryObj } from '@storybook/react'

import { Badge } from '#components/badge'
import { Button } from '#components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardRow,
  CardTitle,
} from '#components/card'

const meta = {
  title: 'Components/Card',
  component: Card,
  argTypes: {
    size: { control: 'inline-radio', options: ['default', 'sm'] },
    variant: { control: 'inline-radio', options: ['default', 'list'] },
  },
  args: { size: 'default' },
} satisfies Meta<typeof Card>

export default meta

type Story = StoryObj<typeof meta>

const sessionRows = [
  { title: 'fix flaky ws reconnect', detail: 'dennis/ws-reconnect · 14 turns' },
  {
    title: 'add storybook coverage spec',
    detail: 'dennis/storybook-spec · 6 turns',
  },
  { title: 'trim sandbox image', detail: 'dennis/slim-image · 9 turns' },
]

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

export const List: Story = {
  args: { variant: 'list' },
  render: (args) => (
    <Card className="w-96" {...args}>
      {sessionRows.map((row) => (
        <CardRow key={row.title}>
          <div className="font-medium">{row.title}</div>
          <div className="text-muted-foreground">{row.detail}</div>
        </CardRow>
      ))}
      <CardFooter className="justify-end">
        <Button size="sm">Add session</Button>
      </CardFooter>
    </Card>
  ),
}
