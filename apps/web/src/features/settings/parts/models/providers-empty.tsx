import { PlugIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

import { PROVIDERS_HREF } from '../../settings-nav'

const TITLE = 'Connect a provider to choose a model'
const DESCRIPTION =
  'Atlas runs the models your provider keys unlock. Add a key for Claude Plan, Codex Plan or the AI Gateway to pick models and effort.'
const ACTION = 'Connect a provider'

export function ProvidersEmpty() {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugIcon />
        </EmptyMedia>
        <EmptyTitle>{TITLE}</EmptyTitle>
        <EmptyDescription>{DESCRIPTION}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button nativeButton={false} render={<a href={PROVIDERS_HREF} />}>
          {ACTION}
        </Button>
      </EmptyContent>
    </Empty>
  )
}
