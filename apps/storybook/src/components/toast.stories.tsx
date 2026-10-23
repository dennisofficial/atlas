import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Button } from '@dltech/atlas-ui/components/button'
import { Toaster, toast } from '@dltech/atlas-ui/components/toast'

const meta = {
  title: 'Components/Toast',
  component: Toaster,
} satisfies Meta<typeof Toaster>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Toaster {...args}>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            toast.add({ title: 'Session saved', description: 'fix flaky ws reconnect' })
          }
        >
          Default
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.add({
              title: 'Tests passing',
              description: '412 passed in 8.2s',
              type: 'success',
            })
          }
        >
          Success
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.add({
              title: 'Sandbox failed to boot',
              description: 'Exit code 137',
              type: 'error',
            })
          }
        >
          Error
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast.add({
              title: 'Session deleted',
              actionProps: { children: 'Undo' },
              type: 'info',
            })
          }
        >
          With action
        </Button>
      </div>
    </Toaster>
  ),
}
