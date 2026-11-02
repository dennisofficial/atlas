import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { ThreadViewSkeleton } from './thread-view-skeleton'

const meta = {
  title: 'Threads/Thread view skeleton',
  parameters: { layout: 'fullscreen' },
}

export default meta

export const ThreadLoadingState = {
  render: () => (
    <SidebarProvider className="h-screen">
      <ThreadViewSkeleton />
    </SidebarProvider>
  ),
}
