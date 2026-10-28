import { FileQuestionIcon } from 'lucide-react'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

export function ThreadMissing() {
  return (
    <Empty variant="outline" className="m-auto max-w-sm">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestionIcon />
        </EmptyMedia>
        <EmptyTitle>Thread not found</EmptyTitle>
        <EmptyDescription>
          It may have been deleted, or it belongs to another account.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
