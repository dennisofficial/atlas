'use client'

import { PlugZapIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

import type { PodWakeState } from '../data/use-pod-wake'

export function PodDisconnected(props: {
  tab: string
  state: PodWakeState
  message?: string | undefined
  onWake: () => void
}) {
  const handleWake = () => props.onWake()
  const asleep = props.state === 'asleep'
  const waking = props.state === 'waking'
  const timeout = props.state === 'timeout'
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <PlugZapIcon className="text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Disconnected</p>
        <p className="text-xs text-muted-foreground">
          {props.tab} live in the pod, which is asleep
        </p>
      </div>
      {props.state === 'elsewhere' ? (
        <p className="text-xs text-muted-foreground">This pod is held by another instance</p>
      ) : null}
      {waking ? (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          Waking pod…
        </span>
      ) : null}
      {timeout ? (
        <p className="text-xs text-muted-foreground">{props.message ?? 'Pod did not wake'}</p>
      ) : null}
      {asleep || timeout ? (
        <Button size="sm" variant="outline" onClick={handleWake}>
          {timeout ? 'Try again' : 'Wake pod'}
        </Button>
      ) : null}
    </div>
  )
}
