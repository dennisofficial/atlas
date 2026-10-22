import Link from 'next/link'
import { PlugZapIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

export const GITHUB_HINT = 'Connect GitHub from the terminal with `atlas`.'

export function ConnectGithub() {
  return (
    <Empty className="rounded-xl border border-dashed border-border py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugZapIcon />
        </EmptyMedia>
        <EmptyTitle>GitHub isn&apos;t connected</EmptyTitle>
        <EmptyDescription>
          Atlas needs your GitHub connection to list repositories. {GITHUB_HINT} Or go back and
          choose No repository.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/settings/integrations" />}
        >
          Open integrations
        </Button>
      </EmptyContent>
    </Empty>
  )
}
