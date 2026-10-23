import { ServerIcon } from 'lucide-react'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

export function SandboxEmpty() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ServerIcon />
        </EmptyMedia>
        <EmptyTitle>No sandboxes running</EmptyTitle>
        <EmptyDescription>They appear here while a cloud thread is running.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
