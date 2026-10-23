import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { toast } from 'sonner'

import { Button } from '@dltech/atlas-ui/components/button'
import { Toaster } from '@dltech/atlas-ui/components/sonner'

const meta = {
  title: 'Components/Sonner',
  component: Toaster,
  decorators: [
    (Story) => (
      <>
        <Story />
      </>
    ),
  ],
} satisfies Meta<typeof Toaster>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <>
      <Toaster {...args} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => toast('Session saved', { description: 'fix flaky ws reconnect' })}
        >
          Default
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.success('Tests passing', { description: '412 passed in 8.2s' })}
        >
          Success
        </Button>
        <Button variant="outline" onClick={() => toast.info('Update available')}>
          Info
        </Button>
        <Button variant="outline" onClick={() => toast.warning('Context 90% full')}>
          Warning
        </Button>
        <Button variant="outline" onClick={() => toast.error('Sandbox failed to boot')}>
          Error
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast('Session deleted', {
              action: { label: 'Undo', onClick: () => toast.success('Restored') },
            })
          }
        >
          With action
        </Button>
      </div>
    </>
  ),
}
