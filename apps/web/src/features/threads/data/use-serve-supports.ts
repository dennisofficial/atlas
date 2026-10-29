'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { supports, type ECapability } from '@dltech/atlas-client/channel'

import type { ServeChannel } from './live-thread-view'

const NO_CAPABILITIES: ReadonlySet<ECapability> = new Set()
const ignoreChanges = () => () => undefined

export function useServeSupports(args: {
  channel: ServeChannel | null
  capability: ECapability
}): boolean {
  const { channel, capability } = args
  const subscribe = useCallback(
    (refresh: () => void) => (channel === null ? ignoreChanges() : channel.onReady(refresh)),
    [channel],
  )
  const capabilities = useSyncExternalStore(
    subscribe,
    () => channel?.capabilities() ?? NO_CAPABILITIES,
    () => NO_CAPABILITIES,
  )
  return supports({ capabilities, capability })
}
