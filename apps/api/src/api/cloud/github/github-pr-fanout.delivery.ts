import type { Logger } from '@nestjs/common'
import type { GithubPrEventDto, GithubPrStateDto } from './github-realtime.types'

export type PrStateHandler = (state: GithubPrStateDto) => void
export type PrEventHandler = (event: GithubPrEventDto) => void
export type WakeHandler = (threadId: string) => void

export type OpenStream = {
  threadId: string | undefined
  handler: PrStateHandler
  eventHandler: PrEventHandler | undefined
  wakeHandler: WakeHandler | undefined
  onClosed: (() => void) | undefined
}

type Delivery = { logger: Logger; userId: string; handlers: ReadonlySet<OpenStream> }

export function deliverState(args: Delivery & { state: GithubPrStateDto }): void {
  for (const entry of args.handlers) {
    try {
      entry.handler(args.state)
    } catch (failure) {
      args.logger.warn(`a stream handler failed for ${args.userId}: ${String(failure)}`)
    }
  }
}

export function deliverWake(args: Delivery & { threadId: string }): void {
  for (const entry of args.handlers) {
    try {
      entry.wakeHandler?.(args.threadId)
    } catch (failure) {
      args.logger.warn(`a wake handler failed for ${args.userId}: ${String(failure)}`)
    }
  }
}

export function deliverEvent(args: Delivery & { event: GithubPrEventDto }): {
  userStream: boolean
  threadIds: string[]
} {
  const delivered = { userStream: false, threadIds: [] as string[] }
  for (const entry of args.handlers) {
    if (entry.eventHandler === undefined) continue
    try {
      entry.eventHandler(args.event)
      if (entry.threadId === undefined) delivered.userStream = true
      else delivered.threadIds.push(entry.threadId)
    } catch (failure) {
      args.logger.warn(`an event handler failed for ${args.userId}: ${String(failure)}`)
    }
  }
  return delivered
}
