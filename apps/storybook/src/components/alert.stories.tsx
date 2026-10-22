import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlertCircleIcon, InfoIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'

const meta = {
  title: 'Components/Alert',
  component: Alert,
  argTypes: {
    variant: { control: 'inline-radio', options: ['default', 'destructive'] },
  },
  args: { variant: 'default' },
  decorators: [
    (Story) => (
      <div className="w-[32rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Alert>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Alert {...args}>
      <InfoIcon />
      <AlertTitle>Session resumed</AlertTitle>
      <AlertDescription>Restored 14 turns from the last checkpoint on atlas/main.</AlertDescription>
    </Alert>
  ),
}

export const Destructive: Story = {
  args: { variant: 'destructive' },
  render: (args) => (
    <Alert {...args}>
      <AlertCircleIcon />
      <AlertTitle>Sandbox failed to boot</AlertTitle>
      <AlertDescription>
        The serve binary exited with code 137. Check the container memory limit and retry.
      </AlertDescription>
    </Alert>
  ),
}

export const WithAction: Story = {
  render: (args) => (
    <Alert {...args}>
      <InfoIcon />
      <AlertTitle>Update available</AlertTitle>
      <AlertDescription>Atlas 0.42 is ready to install.</AlertDescription>
      <AlertAction>
        <Button size="xs" variant="outline">
          Update
        </Button>
      </AlertAction>
    </Alert>
  ),
}

export const TitleOnly: Story = {
  render: (args) => (
    <Alert {...args}>
      <InfoIcon />
      <AlertTitle>Connected to the cloud workspace</AlertTitle>
    </Alert>
  ),
}
