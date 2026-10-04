export type LabelledSandbox = {
  id: string
  worktree: string | undefined
}

export function idleStopDue(args: {
  lastBashAt: number
  runningShells: number
  runningServices: number
  idleMinutes: number
  now: number
}): boolean {
  if (args.runningShells > 0) return false
  if (args.runningServices > 0) return false
  return args.now - args.lastBashAt >= args.idleMinutes * 60_000
}

export function serveIdleDue(args: {
  lastActivityAt: number
  turnRunning: boolean
  childrenSettling: boolean
  runningShells: number
  runningServices: number
  runningChildren?: number | undefined
  pendingInput?: boolean | undefined
  clientsAttached?: number | undefined
  idleMinutes: number
  serviceIdleMinutes?: number | undefined
  now: number
}): boolean {
  if (args.turnRunning) return false
  if (args.childrenSettling) return false
  if ((args.runningChildren ?? 0) > 0) return false
  if (args.runningShells > 0) return false
  if (args.pendingInput === true) return false
  const quietMs = args.now - args.lastActivityAt
  if (args.runningServices === 0) return quietMs >= args.idleMinutes * 60_000
  if ((args.clientsAttached ?? 0) > 0) return false
  return quietMs >= (args.serviceIdleMinutes ?? args.idleMinutes) * 60_000
}

export function staleSandboxes(args: {
  sandboxes: readonly LabelledSandbox[]
  worktrees: readonly string[]
  exists: (path: string) => boolean
}): readonly LabelledSandbox[] {
  const listed = new Set(args.worktrees)

  return args.sandboxes.filter((sandbox) => {
    if (sandbox.worktree === undefined) return false
    if (listed.has(sandbox.worktree)) return false
    return !args.exists(sandbox.worktree)
  })
}
