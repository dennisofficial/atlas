import type { EStreamCacheOutcome, StreamServerMessage } from '@dltech/atlas-protocol'

import type { SessionLog } from './session-log'

export type StreamFollowInput = {
  sessionId: string
  threadId?: string | undefined
  afterSeq?: number | undefined
  afterHash?: string | undefined
  tailViewVersion?: number | undefined
  cache?: EStreamCacheOutcome | undefined
  hydrateMs?: number | undefined
}

export type OlderEventsInput = {
  sessionId: string
  threadId?: string | undefined
  afterSeq: number
  limit: number
}

export type OlderEventsPage = { events: readonly unknown[]; next?: number | undefined }

export type FollowArgs = Pick<StreamFollowInput, 'sessionId' | 'threadId'> & {
  log?: SessionLog | undefined
}

export type StreamSubscription = { close(): void }

export type StreamSubscriptionHandlers = {
  handleFrame(frame: StreamServerMessage): void
  handleFailure(status: number | undefined): void
  handleEnd(): void
}

export type StreamTransport = {
  follow(input: StreamFollowInput, handlers: StreamSubscriptionHandlers): StreamSubscription
  list(handlers: StreamSubscriptionHandlers): StreamSubscription
  events?(input: OlderEventsInput): Promise<OlderEventsPage>
}

export type StreamScheduler = {
  now(): number
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  random(): number
}

export const systemStreamScheduler: StreamScheduler = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  random: () => Math.random(),
}

export type StreamNetworkSignal = (handleSignal: () => void) => () => void

type SignalWindow = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

type SignalDocument = SignalWindow & { readonly visibilityState: string }

export const networkSignalOf =
  (args: { win: SignalWindow | undefined; doc: SignalDocument | undefined }): StreamNetworkSignal =>
  (handleSignal) => {
    const { win, doc } = args
    if (win === undefined || doc === undefined) return () => {}
    const handleVisibility = (): void => {
      if (doc.visibilityState === 'visible') handleSignal()
    }
    win.addEventListener('online', handleSignal)
    doc.addEventListener('visibilitychange', handleVisibility)
    return () => {
      win.removeEventListener('online', handleSignal)
      doc.removeEventListener('visibilitychange', handleVisibility)
    }
  }

const isSignalDocument = (value: unknown): value is SignalDocument =>
  typeof value === 'object' &&
  value !== null &&
  'visibilityState' in value &&
  'addEventListener' in value &&
  'removeEventListener' in value

const globalDocument = (): SignalDocument | undefined => {
  const candidate: unknown = Reflect.get(globalThis, 'document')
  return isSignalDocument(candidate) ? candidate : undefined
}

export const browserNetworkSignal: StreamNetworkSignal = (handleSignal) =>
  networkSignalOf({
    win: typeof globalThis.addEventListener === 'function' ? globalThis : undefined,
    doc: globalDocument(),
  })(handleSignal)
