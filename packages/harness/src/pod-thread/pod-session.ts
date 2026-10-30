import { ENoticeTone, NOTICE_WARN_MS, type NoticePort, type ThreadId } from '@dltech/atlas-core'

import type { CloudChannel, CloudReload, CloudSandboxes } from '../cloud/cloud-bridge'
import { EConnectionView, sameConnectionView, type ConnectionView } from '../cloud/connection-view'
import { ERuntimePhase } from '@dltech/atlas-wire'
import { podFailureReasonOf } from './pod-wake'

export const POD_WAKE_FAILED_NOTICE_KEY = 'cloud-wake-failed'

export type PodHealth = {
  view: ConnectionView
  stale: boolean
  lastSeenAt: number | null
  failure: string | null
}

export type PodSessionChannel = Pick<
  CloudChannel,
  | 'threadId'
  | 'connection'
  | 'onConnection'
  | 'onReload'
  | 'onServerError'
  | 'onTurnEnded'
  | 'beginWake'
  | 'failWake'
  | 'observeCheckpoint'
  | 'attachment'
  | 'reconnect'
  | 'close'
>

export type PodReadiness = {
  applied(): { appliedAt: number } | null
  subscribe(listener: () => void): () => void
  cancelWaiting(): void
}

export type PodSession = {
  threadId: ThreadId
  channel: PodSessionChannel
  health: () => PodHealth
  subscribe: (listener: () => void) => () => void
  reconnect: () => void
  wake: () => void
  settleOpen: () => void
  close: () => void
}

const sameHealth = (left: PodHealth, right: PodHealth): boolean =>
  sameConnectionView({ left: left.view, right: right.view }) &&
  left.stale === right.stale &&
  left.lastSeenAt === right.lastSeenAt &&
  left.failure === right.failure

const NOTHING_TO_WAKE: ReadonlySet<EConnectionView> = new Set([
  EConnectionView.Connected,
  EConnectionView.Detached,
])

const DIALING: ReadonlySet<EConnectionView> = new Set([
  EConnectionView.Waking,
  EConnectionView.Updating,
])

const RESTING_PHASES: ReadonlySet<ERuntimePhase> = new Set([
  ERuntimePhase.Parked,
  ERuntimePhase.Parking,
])

const wakeFailureOf = (error: unknown): string =>
  `the pod could not be woken — ${podFailureReasonOf(error)}`

export function createPodSession(args: {
  channel: PodSessionChannel
  sandboxes: Pick<CloudSandboxes, 'find'>
  wake: () => Promise<void>
  onReload: (reload: CloudReload) => Promise<void>
  notice: NoticePort
  readiness?: PodReadiness | undefined
  settleMs?: number | undefined
  onClose?: (() => void) | undefined
}): PodSession {
  const { channel, sandboxes } = args
  const listeners = new Set<() => void>()
  let closed = false
  let failure: string | null = null
  let connectionEpoch = 0
  let reloadEpoch = 0
  let pendingReload: CloudReload | null = null
  let resyncing = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let waking: Promise<void> | null = null
  let settled = false

  const current = (): PodHealth => ({
    view: channel.connection(),
    stale: pendingReload !== null || resyncing,
    lastSeenAt: args.readiness?.applied()?.appliedAt ?? null,
    failure,
  })
  let held = current()
  const sync = (): void => {
    const next = current()
    if (sameHealth(held, next)) return
    held = next
    for (const listener of [...listeners]) listener()
  }
  const clearRetryTimer = (): void => {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }
  const scheduleRetry = (): void => {
    if (retryTimer !== null) return
    const attachment = connectionEpoch
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (closed || attachment !== connectionEpoch) return
      flushReload()
    }, args.settleMs ?? 2_000)
    retryTimer.unref?.()
  }
  const flushReload = (): void => {
    if (closed || resyncing || pendingReload === null) return
    if (channel.connection().state !== EConnectionView.Connected) return
    const reload = pendingReload
    pendingReload = null
    const attachment = connectionEpoch
    const request = reloadEpoch
    resyncing = true
    let retryScheduled = false
    void args
      .onReload(reload)
      .catch(() => {
        // A resync can fail before it lands — the birth's binding is still committing when the
        // serve's greeting reload arrives, so the TUI's handler rejects. Dropping the reload here
        // would leave the open socket dimmed forever, so it goes back on the pending slot for a
        // settle-timed retry — never an immediate re-flush, which would spin on a persistently
        // rejecting handler.
        if (closed || attachment !== connectionEpoch || request !== reloadEpoch) return
        if (pendingReload === null || reload.sinceEventSeq < pendingReload.sinceEventSeq)
          pendingReload = reload
        scheduleRetry()
        retryScheduled = true
      })
      .finally(() => {
        resyncing = false
        if (closed) return
        sync()
        if (!retryScheduled) flushReload()
      })
  }

  const wake = (): void => {
    if (closed || waking !== null) return
    const state = channel.connection().state
    if (NOTHING_TO_WAKE.has(state)) return
    if (DIALING.has(state) && channel.attachment() !== undefined) return
    channel.beginWake()
    waking = args
      .wake()
      .catch((error: unknown) => {
        if (closed) return
        const reason = wakeFailureOf(error)
        channel.failWake({ reason })
        args.notice.notify({
          key: POD_WAKE_FAILED_NOTICE_KEY,
          text: reason,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
        })
      })
      .finally(() => {
        waking = null
      })
  }

  const settleOpen = (): void => {
    if (closed || settled) return
    settled = true
    void sandboxes.find({ threadId: channel.threadId }).then(
      (status) => {
        if (closed) return
        const checkpoint = status?.checkpoint ?? null
        if (checkpoint !== null) channel.observeCheckpoint(checkpoint)
        if (checkpoint !== null && RESTING_PHASES.has(checkpoint.phase)) return
        wake()
      },
      () => wake(),
    )
  }

  const unsubscribeConnection = channel.onConnection(() => {
    connectionEpoch += 1
    clearRetryTimer()
    sync()
    flushReload()
  })
  const unsubscribeReload = channel.onReload((reload) => {
    reloadEpoch += 1
    if (pendingReload === null || reload.sinceEventSeq < pendingReload.sinceEventSeq)
      pendingReload = reload
    sync()
    flushReload()
  })
  const unsubscribeError = channel.onServerError((refused) => {
    failure = refused.message
    sync()
  })
  const unsubscribeTurnEnded = channel.onTurnEnded((outcome) => {
    if (outcome.status === 'failed' || failure === null) return
    failure = null
    sync()
  })
  const unsubscribeApplied =
    args.readiness?.subscribe(() => {
      if (!closed) sync()
    }) ?? (() => undefined)

  return {
    threadId: channel.threadId,
    channel,
    health: () => held,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reconnect: () => channel.reconnect(),
    wake,
    settleOpen,
    close() {
      closed = true
      connectionEpoch += 1
      clearRetryTimer()
      unsubscribeConnection()
      unsubscribeReload()
      unsubscribeError()
      unsubscribeTurnEnded()
      unsubscribeApplied()
      args.readiness?.cancelWaiting()
      args.onClose?.()
      listeners.clear()
      channel.close()
    },
  }
}
