import type { BrowserReturn, ReturnOutcome } from '@dltech/atlas-core'
import { EReturnResult } from '@dltech/atlas-core'
import { browserReturns } from '@dltech/atlas-client/browser-return'

import { RETURN_CHANNEL_NAME } from './return-action'

const channelOf = (): BroadcastChannel | null =>
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(RETURN_CHANNEL_NAME)

const outcomeOf = (value: unknown): ReturnOutcome | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const result: unknown = Reflect.get(value, 'result')
  if (result !== EReturnResult.Connected && result !== EReturnResult.Failed) return undefined
  const reason: unknown = Reflect.get(value, 'reason')
  return result === EReturnResult.Failed && typeof reason === 'string'
    ? { result, reason }
    : { result }
}

const returnedOf = (data: unknown): BrowserReturn | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  const state: unknown = Reflect.get(data, 'state')
  const outcome = outcomeOf(Reflect.get(data, 'outcome'))
  if (typeof state !== 'string' || state.length === 0 || outcome === undefined) return undefined
  return { state, outcome }
}

export const publishReturn = (returned: BrowserReturn): void => {
  browserReturns.remember(returned)
  const channel = channelOf()
  if (channel === null) return
  channel.postMessage(returned)
  channel.close()
}

export const watchReturns = (): (() => void) => {
  const channel = channelOf()
  if (channel === null) return () => undefined
  const handleMessage = (event: MessageEvent): void => {
    const returned = returnedOf(event.data)
    if (returned !== undefined) browserReturns.remember(returned)
  }
  channel.addEventListener('message', handleMessage)
  return () => {
    channel.close()
  }
}
