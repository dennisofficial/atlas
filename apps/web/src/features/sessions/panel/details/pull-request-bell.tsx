'use client'

import { BellIcon, BellOffIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import { sessionsApi } from '../../data/sessions-api'
import { useSessionPaneValue } from '../pane-value'
import { bellCommandOf, subscriptionOf, type BellCommand } from './pull-request-bell-model'

export type BellRun = (args: { sessionId: string; command: BellCommand }) => Promise<void>

const runThroughApi: BellRun = async ({ sessionId, command }) => {
  await sessionsApi.command({ sessionId, name: command.name, args: command.args })
}

export function PullRequestBell({
  entry,
  run = runThroughApi,
}: {
  entry: PullRequestEntry
  run?: BellRun
}) {
  const { sessionId, view } = useSessionPaneValue()
  const [busy, setBusy] = useState(false)
  const subscription = subscriptionOf({ entry, subscriptions: view.subscriptions })
  const watching = subscription !== undefined
  const command = bellCommandOf({ entry, subscription })
  const label = watching ? 'Unsubscribe from' : 'Subscribe to'

  const handleClick = () => {
    if (command === null) return
    setBusy(true)
    void run({ sessionId, command }).finally(() => setBusy(false))
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${label} #${entry.number}`}
            aria-pressed={watching}
            disabled={busy || command === null}
            onClick={handleClick}
          />
        }
      >
        {watching ? <BellIcon /> : <BellOffIcon />}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label} this pull request</TooltipContent>
    </Tooltip>
  )
}
