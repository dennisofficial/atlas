import Link from 'next/link'
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

import { ESettingsPage, hrefOfPage } from '../settings-nav'

export function ModelsEmpty() {
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
        <Button
          size="sm"
          nativeButton={false}
          render={<Link href={hrefOfPage(ESettingsPage.Providers)} />}
        >
          Open Providers
        </Button>
      </EmptyContent>
    </Empty>
  )
}
