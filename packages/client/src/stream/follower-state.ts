import type { PendingInputsState, V2Event } from '@dltech/atlas-core'
import type {
  EStreamErrorCode,
  SessionStatusOutput,
  SessionViewOutput,
} from '@dltech/atlas-protocol'

import { EStreamConnectionState } from './connection-machine'
import type { DerivedView, FrameFacts } from './derived-session-view'
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
  pending: PendingInputsState
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
  frame: FrameFacts
  derived: DerivedView
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
  pending: inner.window.pending,
  cursor: inner.window.cursor,
  status: inner.derived.status,
  view: inner.derived.view,
  overlay: inner.overlay.open,
  setupOutput: inner.setupOutput,
  shells: inner.shells,
  connection: connectionOf(inner),
  error: inner.error,
  skipped: inner.skipped,
  writerAhead: inner.writerAhead,
  fromCache: inner.fromCache,
})
