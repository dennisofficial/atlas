'use client'

import { CircleCheckIcon, CircleSlashIcon, CircleXIcon, ClockIcon } from 'lucide-react'

import { settledRequestTitleOf } from '@dltech/atlas-plugin-operator/client'
import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@dltech/atlas-ui/components/trace'

import type { RequestItem } from '../data/transcript-items'

const titleOf = (state: RequestItem['state']): string | null =>
  state === 'pending' ? null : settledRequestTitleOf(state)

function TranscriptRequestSettled({ item }: { item: RequestItem }) {
  const failed = item.state === 'failed'
  return (
    <Trace>
      <TraceLine {...(failed ? { status: 'error' as const } : {})}>
        <TraceIcon>
          {item.state === 'delivered' ? <CircleCheckIcon /> : null}
          {item.state === 'cancelled' || item.state === 'abandoned' ? <CircleSlashIcon /> : null}
          {item.state === 'expired' ? <ClockIcon /> : null}
          {failed ? <CircleXIcon /> : null}
        </TraceIcon>
        <TraceTitle>{titleOf(item.state)}</TraceTitle>
        <TraceDescription className="min-w-0 flex-1 truncate">
          {item.reason ?? item.prompt}
        </TraceDescription>
      </TraceLine>
    </Trace>
  )
}

export function TranscriptRequest({ item }: { item: RequestItem }) {
  if (item.state === 'pending') return null
  return <TranscriptRequestSettled item={item} />
}
