import type { ThreadId } from '@dltech/atlas-core'
import {
  cloudLifecycleOf,
  EChannelConnection,
  ECloudFreshness,
  ECloudSandboxLifecycle,
  ERuntimePhase,
  isTranscriptMuted,
  transcriptFreshnessOf,
  type CloudChannel,
  type CloudConnection,
  type CloudReload,
  type CloudSandboxes,
  type CloudSandboxStatus,
  type RuntimeCheckpoint,
} from '@dltech/atlas-harness'

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
  } | null) | undefined
  subscribeApplied?: ((listener: () => void) => () => void) | undefined
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
  let synced = connection.state === EChannelConnection.Open && args.appliedSnapshot?.() != null
  let connectionEpoch = 0
  let inspectionEpoch = 0
  let reloadEpoch = 0
  let pendingReload: CloudReload | null = null
  let resyncing = false
  let parkTimer: ReturnType<typeof setTimeout> | null = null

  const current = (): CloudHealth => {
    const applied = args.appliedSnapshot?.() ?? null
    const reported = status?.checkpoint
    const latest = reported != null && (checkpoint === null || reported.revision > checkpoint.revision)
      ? reported : checkpoint
    const freshness = connection.state === EChannelConnection.Open
      ? synced ? ECloudFreshness.Synced : ECloudFreshness.Unknown
      : transcriptFreshnessOf({
          threadId: channel.threadId,
          lifecycle: sandbox,
          checkpoint: latest,
          observedSandboxSessionId: status?.sandboxSessionId,
          applied: applied?.identity,
        })
    return {
      connection, sandbox, freshness,
      stale: isTranscriptMuted({ lifecycle: sandbox, socketOpen: connection.state === EChannelConnection.Open, freshness }),
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
    void args.onReload(reload).then(() => {
      if (closed || attachment !== connectionEpoch || request !== reloadEpoch) return
      synced = true
      sync()
    }).catch(() => undefined).finally(() => {
      resyncing = false
      flushReload()
    })
  }
  const unsubscribeConnection = channel.onConnection((next) => {
    connection = next
    connectionEpoch += 1
    inspectionEpoch += 1
    synced = false
    clearParkTimer()
    if (next.state === EChannelConnection.Open) {
      sandbox = ECloudSandboxLifecycle.Running
    }
    sync()
    flushReload()
    if (next.state === EChannelConnection.Closed) inspect()
    if (next.state === EChannelConnection.Parked) {
      inspect()
      inspectPark()
    }
  })
  const unsubscribeReload = channel.onReload((reload) => {
    synced = false
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
    if (reported.phase === ERuntimePhase.Parked) inspectPark()
    sync()
  }) ?? (() => undefined)
  const unsubscribeApplied = args.subscribeApplied?.(() => {
    if (closed) return
    if (!resyncing && pendingReload === null && connection.state === EChannelConnection.Open) {
      synced = args.appliedSnapshot?.() != null
    }
    sync()
  }) ?? (() => undefined)
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
      unsubscribeConnection()
      unsubscribeReload()
      unsubscribeError()
      unsubscribeTurnEnded()
      unsubscribeCheckpoint()
      unsubscribeApplied()
      args.onClose?.()
      listeners.clear()
      channel.close()
    },
  }
}
