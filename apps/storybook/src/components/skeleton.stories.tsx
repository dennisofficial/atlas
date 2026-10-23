import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="flex w-72 items-center gap-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  ),
}

export const List: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  ),
}
