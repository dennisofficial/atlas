import { BotIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

export function ModelsEmpty({ onOpenProviders }: { onOpenProviders: () => void }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon />
        </EmptyMedia>
        <EmptyTitle>No providers connected</EmptyTitle>
        <EmptyDescription>Connect a subscription or API key to choose models.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={onOpenProviders}>
          Open Providers
        </Button>
      </EmptyContent>
    </Empty>
  )
}
