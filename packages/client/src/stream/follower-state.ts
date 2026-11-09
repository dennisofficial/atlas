import type { V2Event } from '@dltech/atlas-core'
import type {
  EStreamErrorCode,
  SessionStatusOutput,
  SessionViewOutput,
} from '@dltech/atlas-protocol'

import { EStreamConnectionState } from './connection-machine'
import type { OpenOverlay, OverlayState } from './overlay-store'
import type { SessionCursor, SessionWindow } from './session-window'
import type { ShellTail } from './shell-tails'

export enum ESessionConnection {
  Live = 'live',
  CatchingUp = 'catching-up',
  Reconnecting = 'reconnecting',
  Offline = 'offline',
}

export type SessionSnapshot = {
  events: readonly V2Event[]
  cursor: SessionCursor | undefined
  status: SessionStatusOutput | undefined
  view?: SessionViewOutput | undefined
  overlay: OpenOverlay | undefined
  setupOutput?: string | undefined
  shells: Readonly<Record<string, ShellTail>>
  connection: ESessionConnection
  error: EStreamErrorCode | undefined
  skipped: number
  writerAhead: boolean
  fromCache: boolean
}

export type FollowedState = {
  window: SessionWindow
  overlay: OverlayState
  status: SessionStatusOutput | undefined
  view: SessionViewOutput | undefined
  setupOutput: string
  shells: Readonly<Record<string, ShellTail>>
  phase: EStreamConnectionState
  live: boolean
  error: EStreamErrorCode | undefined
  skipped: number
  writerAhead: boolean
  fromCache: boolean
}

export const connectionOf = (inner: Pick<FollowedState, 'phase' | 'live'>): ESessionConnection => {
  if (inner.phase === EStreamConnectionState.Closed) return ESessionConnection.Offline
  if (inner.phase !== EStreamConnectionState.Open) return ESessionConnection.Reconnecting
  return inner.live ? ESessionConnection.Live : ESessionConnection.CatchingUp
}

export const snapshotOf = (inner: FollowedState): SessionSnapshot => ({
  events: inner.window.events,
  cursor: inner.window.cursor,
  status: inner.status,
  view: inner.view,
  overlay: inner.overlay.open,
  setupOutput: inner.setupOutput,
  shells: inner.shells,
  connection: connectionOf(inner),
  error: inner.error,
  skipped: inner.skipped,
  writerAhead: inner.writerAhead,
  fromCache: inner.fromCache,
})
