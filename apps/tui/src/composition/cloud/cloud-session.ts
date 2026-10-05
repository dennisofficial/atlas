import type { Event, ThreadId } from '@dltech/atlas-core'
import {
  closedConnectionOf,
  cloudLifecycleOf,
  EChannelConnection,
  EClosedConnectionKind,
  ECloudSandboxState,
  ECloudFreshness,
  ECloudSandboxLifecycle,
  EParkedResume,
  ERuntimePhase,
  isTranscriptMuted,
  parkedResumeOf,
  transcriptFreshnessOf,
  type CloudChannel,
  type CloudConnection,
  type CloudReload,
  type CloudSandboxes,
  type CloudSandboxStatus,
  type RuntimeCheckpoint,
} from '@dltech/atlas-harness'

import { parkedFreshnessOf } from './parked-resume'

const DELIBERATE_REATTACH = new Set<EChannelConnection>([
  EChannelConnection.Connecting,
  EChannelConnection.Reattaching,
  EChannelConnection.Waking,
])

export type CloudHealth = {
  connection: CloudConnection
  sandbox: ECloudSandboxLifecycle
  freshness: ECloudFreshness
  stale: boolean
  lastSeenAt: number | null
  failure: string | null
}

export type CloudSession = {
  threadId: ThreadId
  channel: CloudChannel
  health: () => CloudHealth
  subscribe: (listener: () => void) => () => void
  reconnect: () => void
  close: () => void
}

const sameHealth = (left: CloudHealth, right: CloudHealth): boolean =>
  left.connection.state === right.connection.state &&
  left.connection.detail === right.connection.detail &&
  left.sandbox === right.sandbox && left.freshness === right.freshness &&
  left.stale === right.stale && left.lastSeenAt === right.lastSeenAt && left.failure === right.failure

export function createCloudSession(args: {
  channel: CloudChannel
  sandboxes: CloudSandboxes
  onReload: (reload: CloudReload) => Promise<void>
  appliedSnapshot?: (() => {
    identity: { head: number; count: number; digest: string }
    appliedAt: number
    events?: readonly Event[] | undefined
  } | null) | undefined
  subscribeApplied?: ((listener: () => void) => () => void) | undefined
  parkedResume?: EParkedResume | undefined
  onParked?: ((checkpoint: RuntimeCheckpoint) => void) | undefined
  settleMs?: number | undefined
  onClose?: (() => void) | undefined
}): CloudSession {
  const { channel, sandboxes } = args
  const listeners = new Set<() => void>()
  let closed = false
  let connection = channel.connection()
  let sandbox = connection.state === EChannelConnection.Open
    ? ECloudSandboxLifecycle.Running : ECloudSandboxLifecycle.Unknown
  let status: CloudSandboxStatus | null = null
  let checkpoint: RuntimeCheckpoint | null = channel.checkpoint?.() ?? null
  let failure: string | null = null
  // The serve vouched, at the latest Ready, that the log's head is the hello's lastEventSeq.
  let vouched = false
  // The latest Ready carried the transcriptCurrent field at all — a serve built before it does
  // not, and keeps the pre-vouch freshness semantics.
  let vouchOffered = false
  // The log has fallen behind what the socket has since reported: a reload is in flight or due.
  let dirty = false
  let connectionEpoch = 0
  let inspectionEpoch = 0
  let reloadEpoch = 0
  let pendingReload: CloudReload | null = null
  let resyncing = false
  let parkTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let everOpen = connection.state === EChannelConnection.Open

  const CLOSED_DETAIL = {
    resuming: 'the sandbox is resuming',
    missing: 'the sandbox provider has no live sandbox for this conversation — no sandbox answers it',
    running: 'the sandbox provider says the sandbox is running, but it is not answering',
  }

  const current = (): CloudHealth => {
    const applied = args.appliedSnapshot?.() ?? null
    const reported = status?.checkpoint
    const latest = reported != null && (checkpoint === null || reported.revision > checkpoint.revision)
      ? reported : checkpoint
    const parked = everOpen ? undefined : args.parkedResume
    const announced =
      checkpoint !== null && checkpoint.phase === ERuntimePhase.Parked ? checkpoint : null
    const lifecycle =
      parked === undefined && announced === null ? sandbox : ECloudSandboxLifecycle.Parked
    // A deliberate re-attach (wake, /restart) that has not yet re-vouched holds the freshness the
    // log already earned — closing the socket on purpose does not make the log less correct. The
    // hold reads as parked+synced to the mute rule: a known-whole log whose transport is briefly
    // away on the client's own say-so.
    const holding =
      vouched && !dirty && announced === null && DELIBERATE_REATTACH.has(connection.state)
    const freshness = parked !== undefined
      ? parkedFreshnessOf(parked)
      : holding || (connection.state === EChannelConnection.Open && vouched && !dirty)
      ? ECloudFreshness.Synced
      : announced !== null
      ? parkedFreshnessOf(
          parkedResumeOf({ record: { checkpoint: announced, applied: applied?.identity ?? null } }),
        )
      : transcriptFreshnessOf({
          threadId: channel.threadId,
          lifecycle: sandbox,
          checkpoint: latest,
          observedSandboxSessionId: status?.sandboxSessionId,
          applied: applied?.identity,
        })
    return {
      connection, sandbox, freshness,
      stale: isTranscriptMuted({
        lifecycle: holding ? ECloudSandboxLifecycle.Parked : lifecycle,
        socketOpen: connection.state === EChannelConnection.Open,
        freshness,
        tailIsParked: applied?.events?.at(-1)?.type === 'parked',
      }),
      lastSeenAt: applied?.appliedAt ?? null,
      failure,
    }
  }
  let held = current()
  const sync = (): void => {
    const next = current()
    if (sameHealth(held, next)) return
    held = next
    for (const listener of [...listeners]) listener()
  }
  const inspect = (): void => {
    const epoch = ++inspectionEpoch
    const attachment = connectionEpoch
    void sandboxes.find({ threadId: channel.threadId }).then((observed) => {
      if (closed || epoch !== inspectionEpoch || attachment !== connectionEpoch) return
      status = observed ?? null
      sandbox = observed === undefined ? ECloudSandboxLifecycle.Unknown : cloudLifecycleOf(observed.state)
      if (connection.state === EChannelConnection.Closed && failure === null) {
        const reading = closedConnectionOf({
          state: observed?.state ?? ECloudSandboxState.Unknown,
          ...CLOSED_DETAIL,
        })
        connection =
          reading.kind === EClosedConnectionKind.Parked
            ? { state: EChannelConnection.Parked, detail: null }
            : reading.kind === EClosedConnectionKind.Waking
              ? { state: EChannelConnection.Waking, detail: reading.detail }
              : reading.kind === EClosedConnectionKind.Reconnecting
                ? { state: EChannelConnection.Reconnecting, detail: reading.detail }
                : { state: EChannelConnection.Closed, detail: reading.detail }
      }
      sync()
    }).catch(() => {
      if (closed || epoch !== inspectionEpoch || attachment !== connectionEpoch) return
      status = null
      sandbox = ECloudSandboxLifecycle.Unknown
      sync()
    })
  }
  const clearParkTimer = (): void => {
    if (parkTimer !== null) clearTimeout(parkTimer)
    parkTimer = null
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
  const inspectPark = (): void => {
    if (parkTimer !== null) return
    const attachment = connectionEpoch
    parkTimer = setTimeout(() => {
      parkTimer = null
      if (closed || attachment !== connectionEpoch) return
      inspect()
    }, args.settleMs ?? 2_000)
    parkTimer.unref?.()
  }
  const flushReload = (): void => {
    if (closed || resyncing || pendingReload === null || connection.state !== EChannelConnection.Open) return
    const reload = pendingReload
    pendingReload = null
    const attachment = connectionEpoch
    const request = reloadEpoch
    resyncing = true
    let retryScheduled = false
    void args.onReload(reload).then(() => {
      if (closed || attachment !== connectionEpoch || request !== reloadEpoch) return
      vouched = true
      dirty = false
      sync()
    }).catch(() => {
      // A resync can fail before it lands — the lift's binding is still committing when the
      // serve's greeting reload arrives, so the TUI's handler rejects. Dropping the reload here
      // would leave the open socket dimmed forever, so it goes back on the pending slot for a
      // settle-timed retry — never an immediate re-flush, which would spin on a persistently
      // rejecting handler.
      if (closed || attachment !== connectionEpoch || request !== reloadEpoch) return
      if (pendingReload === null || reload.sinceEventSeq < pendingReload.sinceEventSeq) pendingReload = reload
      scheduleRetry()
      retryScheduled = true
    }).finally(() => {
      resyncing = false
      if (!retryScheduled) flushReload()
    })
  }
  const unsubscribeConnection = channel.onConnection((next) => {
    connection = next
    connectionEpoch += 1
    inspectionEpoch += 1
    if (next.state === EChannelConnection.Open) {
      everOpen = true
      sandbox = ECloudSandboxLifecycle.Running
    } else if (!DELIBERATE_REATTACH.has(next.state)) {
      // The socket dropped out from under the session (Reconnecting/Closed/Parked): the serve may
      // have appended while no wire carried it, so the last vouch no longer holds.
      vouched = false
    }
    clearParkTimer()
    clearRetryTimer()
    sync()
    flushReload()
    if (next.state === EChannelConnection.Closed) inspect()
    if (next.state === EChannelConnection.Parked) {
      inspect()
      inspectPark()
    }
  })
  const unsubscribeReload = channel.onReload((reload) => {
    dirty = true
    reloadEpoch += 1
    if (pendingReload === null || reload.sinceEventSeq < pendingReload.sinceEventSeq) pendingReload = reload
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
  const unsubscribeCheckpoint = channel.onCheckpoint?.((reported) => {
    if (closed || reported.threadId !== channel.threadId) return
    if (checkpoint !== null && reported.revision <= checkpoint.revision) return
    checkpoint = reported
    if (reported.phase === ERuntimePhase.Parked) {
      inspectPark()
      args.onParked?.(reported)
    }
    sync()
  }) ?? (() => undefined)
  const unsubscribeApplied = args.subscribeApplied?.(() => {
    if (closed) return
    if (!resyncing && pendingReload === null && connection.state === EChannelConnection.Open) {
      dirty = false
      if (!vouchOffered) vouched = args.appliedSnapshot?.() != null
    }
    sync()
  }) ?? (() => undefined)
  const unsubscribeReady = channel.onReady((ready) => {
    if (closed) return
    vouchOffered = ready.transcriptCurrent !== undefined
    if (ready.transcriptCurrent === true) {
      vouched = true
      dirty = false
    }
    sync()
  })
  if (connection.state === EChannelConnection.Closed || connection.state === EChannelConnection.Parked) inspect()

  return {
    threadId: channel.threadId,
    channel,
    health: () => held,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    reconnect: () => channel.reconnect(),
    close() {
      closed = true
      connectionEpoch += 1
      clearParkTimer()
      clearRetryTimer()
      unsubscribeConnection()
      unsubscribeReload()
      unsubscribeError()
      unsubscribeTurnEnded()
      unsubscribeCheckpoint()
      unsubscribeApplied()
      unsubscribeReady()
      args.onClose?.()
      listeners.clear()
      channel.close()
    },
  }
}
