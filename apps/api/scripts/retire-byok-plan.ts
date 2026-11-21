export type ByokSessionRow = {
  sessionId: string
  userId: string
  podSessionId: string | null
  archivedAt: Date | null
}

export type PodSandboxRow = {
  name: string
  podSessionId: string | null
  running: boolean
}

export type ByokRetirePlan = {
  stop: readonly PodSandboxRow[]
  remove: readonly PodSandboxRow[]
  keep: readonly PodSandboxRow[]
}

/** A sub-agent session shares its spawner's pod, so the pod to retire is the one it points at. */
export const podIdOf = (session: ByokSessionRow): string =>
  session.podSessionId ?? session.sessionId

export const byokPodIdsOf = (sessions: readonly ByokSessionRow[]): ReadonlySet<string> =>
  new Set(sessions.map(podIdOf))

export const sessionsByUserOf = (
  sessions: readonly ByokSessionRow[],
): ReadonlyMap<string, readonly ByokSessionRow[]> => {
  const byUser = new Map<string, ByokSessionRow[]>()
  for (const session of sessions) {
    const rows = byUser.get(session.userId) ?? []
    rows.push(session)
    byUser.set(session.userId, rows)
  }
  return byUser
}

/**
 * Only the sandboxes one of these sessions runs on are touched; every other pod in the account is
 * kept. A running pod is stopped before it is deleted because Vercel refuses to delete a live one.
 */
export const planByokRetire = (args: {
  sandboxes: readonly PodSandboxRow[]
  pods: ReadonlySet<string>
}): ByokRetirePlan => {
  const stop: PodSandboxRow[] = []
  const remove: PodSandboxRow[] = []
  const keep: PodSandboxRow[] = []
  for (const sandbox of args.sandboxes) {
    if (sandbox.podSessionId === null || !args.pods.has(sandbox.podSessionId)) {
      keep.push(sandbox)
      continue
    }
    if (sandbox.running) stop.push(sandbox)
    remove.push(sandbox)
  }
  return { stop, remove, keep }
}

/** Retiring a session hides it from every list and drops it on the next archived-session sweep. */
export const retirePatchOf = (args: {
  session: ByokSessionRow
  now: Date
}): {
  archivedAt: Date
  deletedAt: Date
} => ({ archivedAt: args.session.archivedAt ?? args.now, deletedAt: args.now })
