import type { ThreadId } from '@dltech/atlas-core'
import {
  MainWake,
  type AgentRegistryPort,
  type AgentSnapshot,
  type PendingShellNotice,
  type ServiceRegistryPort,
  type ServiceSnapshot,
  type ShellRegistryPort,
} from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

/**
 * The TUI's binding of the harness idle wake: the registries' pending notices are read as a React
 * store so the surface still renders them, and MainWake — the mechanism serve also composes —
 * owns the witness and the anti-spin bound. A turn must not start behind a prompt that has taken
 * the keyboard, so an overlay waiting on an answer holds the wake off through `canWake`; the
 * ending keeps until it clears.
 *
 * Only this thread's endings are read, and only this thread is woken: a shell, service or child
 * belongs to whoever started it.
 */
export function useMainWake(args: {
  shells: ShellRegistryPort
  agents: AgentRegistryPort
  services: ServiceRegistryPort
  threadId: ThreadId
  working: boolean
  canWake: boolean
  onWake: () => void
}): {
  shells: readonly PendingShellNotice[]
  agents: readonly AgentSnapshot[]
  services: readonly ServiceSnapshot[]
} {
  const { shells, agents, services, threadId, working, canWake, onWake } = args

  const subscribe = useCallback(
    (listener: () => void) => {
      const offs = [
        shells.onNotice(listener),
        agents.onNotice(listener),
        services.onNotice(listener),
      ]
      return () => {
        for (const off of offs) off()
      }
    },
    [shells, agents, services],
  )

  const readShells = useCallback(
    () => shells.pendingNotices({ threadId }),
    [shells, threadId],
  )
  const readAgents = useCallback(() => agents.pendingNotices({ threadId }), [agents, threadId])
  const readServices = useCallback(
    () => services.pendingNotices({ threadId }),
    [services, threadId],
  )

  const shellNotices = useSyncExternalStore(subscribe, readShells)
  const agentNotices = useSyncExternalStore(subscribe, readAgents)
  const serviceNotices = useSyncExternalStore(subscribe, readServices)

  const wake = useMemo(() => new MainWake({ blocked: () => blockedRef.current, onWake }), [onWake])
  const blockedRef = useRef(working || !canWake)
  blockedRef.current = working || !canWake

  const witness =
    shellNotices.length === 0 && agentNotices.length === 0 && serviceNotices.length === 0
      ? null
      : [
          ...shellNotices.map((notice) => `${notice.kind}:${notice.snapshot.shellId}`),
          ...agentNotices.map((notice) => notice.agentId),
          ...serviceNotices.map((notice) => notice.serviceId),
        ].join(' ')

  useEffect(() => {
    wake.onNotice({ witness })
  })

  return { shells: shellNotices, agents: agentNotices, services: serviceNotices }
}
