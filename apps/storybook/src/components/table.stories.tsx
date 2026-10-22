import type { Meta, StoryObj } from '@storybook/react-vite'

import { Badge } from '@dltech/atlas-ui/components/badge'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'

const meta = {
  title: 'Components/Table',
  component: Table,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Table>

export default meta

type Story = StoryObj<typeof meta>

const sessions = [
  {
    name: 'fix flaky ws reconnect',
    branch: 'dennis/ws-reconnect',
    model: 'claude-opus',
    state: 'Running',
    cost: 4.21,
  },
  {
    name: 'add storybook coverage spec',
    branch: 'dennis/storybook-spec',
    model: 'claude-sonnet',
    state: 'Waiting',
    cost: 1.08,
  },
  {
    name: 'migrate web to shadcn',
    branch: 'dennis/shadcn-ui-storybook',
    model: 'gpt-5',
    state: 'Done',
    cost: 9.64,
  },
  {
    name: 'trim sandbox image',
    branch: 'dennis/slim-image',
    model: 'claude-sonnet',
    state: 'Done',
    cost: 2.37,
  },
]

const stateVariant = { Running: 'default', Waiting: 'secondary', Done: 'outline' } as const

export const Default: Story = {
  render: () => (
    <div className="w-[48rem] max-w-full">
      <Table>
        <TableCaption>Sessions in the atlas workspace.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Session</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.name}>
              <TableCell className="font-medium">{session.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {session.branch}
              </TableCell>
              <TableCell>{session.model}</TableCell>
              <TableCell>
                <Badge variant={stateVariant[session.state as keyof typeof stateVariant]}>
                  {session.state}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">${session.cost.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell className="text-right tabular-nums">
              ${sessions.reduce((sum, session) => sum + session.cost, 0).toFixed(2)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  ),
}

export const SelectedRow: Story = {
  render: () => (
    <div className="w-[32rem] max-w-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Session</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.slice(0, 3).map((session, index) => (
            <TableRow key={session.name} data-state={index === 1 ? 'selected' : undefined}>
              <TableCell>{session.name}</TableCell>
              <TableCell className="text-right tabular-nums">${session.cost.toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
}
