'use client'

import { useId, useState } from 'react'

import { Switch } from '@dltech/atlas-ui/components/switch'

import { sessionsApi } from '../../data/sessions-api'
import { useSessionPaneValue } from '../pane-value'
import { followingCommandsOf, followingOf, type FollowingCommand } from './following'

export type FollowingRun = (args: {
  sessionId: string
  commands: readonly FollowingCommand[]
}) => Promise<void>

const runThroughApi: FollowingRun = async ({ sessionId, commands }) => {
  for (const command of commands) {
    await sessionsApi.command({ sessionId, name: command.name, args: command.args })
  }
}

export function SessionFollowingSwitch({ run = runThroughApi }: { run?: FollowingRun } = {}) {
  const { sessionId, view } = useSessionPaneValue()
  const id = useId()
  const [busy, setBusy] = useState(false)
  const following = followingOf({ entries: view.entries, subscriptions: view.subscriptions })

  const handleCheckedChange = (checked: boolean) => {
    const commands = followingCommandsOf({
      entries: view.entries,
      subscriptions: view.subscriptions,
      following: checked,
    })
    if (commands.length === 0) return
    setBusy(true)
    void run({ sessionId, commands }).finally(() => setBusy(false))
  }

  return (
    <label
      htmlFor={id}
      className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground"
    >
      Following
      <Switch
        id={id}
        size="sm"
        checked={following}
        disabled={busy || view.entries.length === 0}
        aria-label="Follow this session's pull requests"
        onCheckedChange={handleCheckedChange}
      />
    </label>
  )
}
